/////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Tencent is pleased to support the open source community by making tgfx-displaylist available.
//
//  Copyright (C) 2025 Tencent. All rights reserved.
//
//  Licensed under the BSD 3-Clause License (the "License"); you may not use this file except
//  in compliance with the License. You may obtain a copy of the License at
//
//      https://opensource.org/licenses/BSD-3-Clause
//
//  unless required by applicable law or agreed to in writing, software distributed under the
//  license is distributed on an "as is" basis, without warranties or conditions of any kind,
//  either express or implied. see the license for the specific language governing permissions
//  and limitations under the license.
//
/////////////////////////////////////////////////////////////////////////////////////////////////

import { ShareData } from './common';

/**
 * 局部空间交互管理器
 * 
 * 核心思想：使用逆矩阵将鼠标从世界坐标转换到本地坐标空间，
 * 在本地空间中进行所有的判断和计算，避免复杂的三角函数运算。
 * 
 * 优势：
 * - 无论旋转多少度、翻转多少次，逻辑都保持一致
 * - 只需一次逆矩阵计算（点击时），后续只是简单的加减乘除
 * - 对角点的计算简化为 (1-x, 1-y) 的中心对称
 */
export class LocalSpaceInteraction {
  private inverseMatrix: number[] | null = null;  // 缓存的逆矩阵 [a, b, c, d, e, f]
  private layerBounds: { width: number; height: number } | null = null;  // 图层边界（局部空间）
  private isMatrixCached = false;
  private cachedMatrixHash: string | null = null;  // 缓存的矩阵哈希，用于检测矩阵改变

  /**
   * 定义8个控制点的【归一化坐标】(0-1范围)
   * 
   * 这是核心：无论旋转、翻转多少次，这些归一化坐标永远不变。
   * 命中测试通过在归一化空间中判断距离来完成。
   */
  private readonly NORMALIZED_HANDLES = [
    { id: 0, name: '左上角', x: 0, y: 0 },
    { id: 1, name: '右上角', x: 1, y: 0 },
    { id: 2, name: '右下角', x: 1, y: 1 },
    { id: 3, name: '左下角', x: 0, y: 1 },
    { id: 4, name: '上边中', x: 0.5, y: 0 },
    { id: 5, name: '右边中', x: 1, y: 0.5 },
    { id: 6, name: '下边中', x: 0.5, y: 1 },
    { id: 7, name: '左边中', x: 0, y: 0.5 },
  ];

  /**
   * 计算矩阵和边界的哈希值，用于检测是否需要重新缓存
   * 
   * 重要：必须同时包含矩阵和边界信息，因为不同图层可能有相同的变换矩阵但不同的尺寸
   */
  private getCacheHash(matrix: number[], bounds: { width: number; height: number }): string {
    // 同时包含矩阵和边界信息
    const matrixStr = matrix.map(v => v.toFixed(4)).join(',');
    const boundsStr = `${bounds.width.toFixed(2)},${bounds.height.toFixed(2)}`;
    return `${matrixStr}|${boundsStr}`;
  }

  /**
   * 计算并缓存逆矩阵
   * 
   * @param shareData 共享数据（包含 C++ 对象引用）
   * @returns 是否成功缓存
   */
  public cacheInverseMatrix(shareData: ShareData): boolean {
    if (!shareData.tgfxBaseView) {
      console.error('[LocalSpace] tgfxBaseView 为空，无法缓存逆矩阵');
      return false;
    }

    try {
      // 从 C++ 获取选中图层的全局矩阵
      const matrixVector = (shareData.tgfxBaseView as any).getSelectedLayerWorldMatrix();
      if (!matrixVector) {
        console.error('[LocalSpace] getSelectedLayerWorldMatrix 返回 null/undefined');
        return false;
      }

      // 验证是否有 size 方法，处理可能的特殊情况
      if (typeof matrixVector.size !== 'function') {
        console.error('[LocalSpace] matrixVector 没有 size 方法，类型:', typeof matrixVector);
        return false;
      }

      const size = matrixVector.size();
      if (size < 6) {
        console.error(`[LocalSpace] 矩阵大小不足，期望6个元素，实际${size}个`);
        return false;
      }

      // 提取矩阵的 6 个分量 [a, b, c, d, e, f]，添加验证
      const matrix: number[] = [];
      for (let i = 0; i < 6; i++) {
        try {
          const value = matrixVector.get(i);
          if (typeof value !== 'number') {
            console.error(`[LocalSpace] 矩阵元素${i}不是数字，类型:${typeof value}`);
            return false;
          }
          matrix.push(value);
        } catch (e) {
          console.error(`[LocalSpace] 无法获取矩阵元素${i}:`, e);
          return false;
        }
      }

      console.log('[LocalSpace] 世界矩阵:', matrix);

      // 先获取图层的本地边界（在检查缓存之前，因为需要边界来计算哈希）
      let newBounds: { width: number; height: number } | null = null;
      try {
        const boundsVector = (shareData.tgfxBaseView as any).getSelectedLayerLocalBounds();
        if (boundsVector && typeof boundsVector.size === 'function' && boundsVector.size() >= 4) {
          const left = boundsVector.get(0);
          const top = boundsVector.get(1);
          const right = boundsVector.get(2);
          const bottom = boundsVector.get(3);
          
          console.log(`[LocalSpace] 本地边界: left=${left}, top=${top}, right=${right}, bottom=${bottom}`);
          
          newBounds = {
            width: Math.abs(right - left),
            height: Math.abs(bottom - top)
          };
        }
      } catch (e) {
        console.error('[LocalSpace] 无法获取图层本地边界:', e);
      }

      if (!newBounds) {
        console.error('[LocalSpace] 无法获取有效的图层边界');
        return false;
      }

      // 检查缓存是否有效（同时检查矩阵和边界）
      const currentCacheHash = this.getCacheHash(matrix, newBounds);
      if (this.isMatrixCached && this.cachedMatrixHash === currentCacheHash) {
        // 缓存有效，无需重新计算
        console.log('[LocalSpace] 使用缓存的逆矩阵（矩阵和边界均未改变）');
        return true;
      }

      // 缓存无效，重新计算逆矩阵
      this.inverseMatrix = this.invertMatrix(matrix);
      if (!this.inverseMatrix) {
        console.error('[LocalSpace] 矩阵不可逆，行列式接近0，矩阵:', matrix);
        return false;
      }

      console.log('[LocalSpace] 逆矩阵:', this.inverseMatrix);

      // 更新边界缓存
      this.layerBounds = newBounds;
      console.log(`[LocalSpace] 更新图层边界: ${newBounds.width.toFixed(1)} x ${newBounds.height.toFixed(1)}`);

      this.isMatrixCached = true;
      this.cachedMatrixHash = currentCacheHash;
      return true;
    } catch (error) {
      console.error('[LocalSpace] 缓存逆矩阵失败:', error);
      this.isMatrixCached = false;
      this.cachedMatrixHash = null;
      return false;
    }
  }

  /**
   * 将屏幕坐标转换到本地坐标空间
   * 
   * @param screenX 屏幕坐标 X
   * @param screenY 屏幕坐标 Y
   * @param shareData 共享数据
   * @returns 本地坐标 { x, y }，如果失败返回 null
   */
  public screenToLocalCoord(screenX: number, screenY: number, shareData: ShareData): { x: number; y: number } | null {
    // 如果逆矩阵未缓存，尝试现场缓存一次
    if (!this.isMatrixCached || !this.inverseMatrix) {
      if (!this.cacheInverseMatrix(shareData)) {
        console.error('[LocalSpace] 无法获取逆矩阵，转换失败');
        return null;
      }
    }

    // 屏幕坐标 → 世界坐标
    const worldX = (screenX - shareData.offsetX) / shareData.zoom;
    const worldY = (screenY - shareData.offsetY) / shareData.zoom;

    // 世界坐标 → 本地坐标（使用逆矩阵）
    const localX = this.inverseMatrix![0] * worldX + this.inverseMatrix![2] * worldY + this.inverseMatrix![4];
    const localY = this.inverseMatrix![1] * worldX + this.inverseMatrix![3] * worldY + this.inverseMatrix![5];

    return { x: localX, y: localY };
  }

  /**
   * 【核心函数】使用本地坐标进行命中测试
   * 
   * 原理：
   * 1. 计算鼠标本地坐标到各控制点的本地距离
   * 2. 使用固定的本地像素容差（而不是归一化容差）
   * 3. 返回最近的控制点及其归一化距离（用于区分缩放/旋转区域）
   * 
   * 重要说明：
   * - 使用逆矩阵将世界坐标转换到本地坐标，所以所有变换（旋转、翻转、缩放）都已经被处理
   * - 在本地坐标空间中，角的逻辑位置始终是：0=左上, 1=右上, 2=右下, 3=左下
   * - 无论图层如何旋转或翻转，这些逻辑位置都保持不变
   * 
   * @param localX 本地坐标X
   * @param localY 本地坐标Y
   * @param tolerancePixels 容差（本地像素），默认30像素
   */
  public hitTestNormalizedHandles(localX: number, localY: number, tolerancePixels: number = 30): 
    { handleId: number; name: string; normalizedX: number; normalizedY: number; distance: number } | null {
    
    if (!this.layerBounds) {
      console.log('[命中测试] layerBounds 为空');
      return null;
    }

    const { width, height } = this.layerBounds;
    
    // 计算归一化坐标（用于返回值）
    const normalizedX = localX / width;
    const normalizedY = localY / height;
    
    // 计算归一化容差（基于图层对角线长度）
    const diagonalLength = Math.sqrt(width * width + height * height);
    const toleranceNormalized = tolerancePixels / diagonalLength;

    console.log(`[命中测试] 图层边界: ${width.toFixed(1)} x ${height.toFixed(1)}, 对角线: ${diagonalLength.toFixed(1)}`);
    console.log(`[命中测试] 本地坐标: (${localX.toFixed(1)}, ${localY.toFixed(1)}), 像素容差: ${tolerancePixels}, 归一化容差: ${toleranceNormalized.toFixed(3)}`);

    let bestHandle: { handleId: number; name: string; normalizedX: number; normalizedY: number; distance: number } | null = null;
    let minLocalDistance = Infinity;

    // 计算到各控制点的本地像素距离
    for (const handle of this.NORMALIZED_HANDLES) {
      // 控制点的本地坐标
      const handleLocalX = handle.x * width;
      const handleLocalY = handle.y * height;
      
      // 本地像素距离
      const dx = localX - handleLocalX;
      const dy = localY - handleLocalY;
      const localDistance = Math.sqrt(dx * dx + dy * dy);

      if (localDistance < tolerancePixels && localDistance < minLocalDistance) {
        minLocalDistance = localDistance;
        // 计算归一化距离（用于区分缩放/旋转区域）
        const normalizedDistance = localDistance / diagonalLength;
        bestHandle = {
          handleId: handle.id,
          name: handle.name,
          normalizedX: handle.x,
          normalizedY: handle.y,
          distance: normalizedDistance  // 返回归一化距离
        };
      }
    }

    // 输出最近的角距离（用于调试）
    const cornerDistances = this.NORMALIZED_HANDLES.slice(0, 4).map(h => {
      const handleLocalX = h.x * width;
      const handleLocalY = h.y * height;
      const dx = localX - handleLocalX;
      const dy = localY - handleLocalY;
      const localDist = Math.sqrt(dx * dx + dy * dy);
      return { name: h.name, dist: localDist.toFixed(1) };
    });
    console.log(`[命中测试] 到各角像素距离:`, cornerDistances.map(c => `${c.name}:${c.dist}px`).join(', '));

    return bestHandle;
  }

  /**
   * 转换本地坐标为归一化坐标
   * @param localX 本地X坐标
   * @param localY 本地Y坐标
   * @returns 归一化坐标 {x, y} 或 null
   */
  public localToNormalized(localX: number, localY: number): { x: number; y: number } | null {
    if (!this.layerBounds) {
      return null;
    }
    return {
      x: localX / this.layerBounds.width,
      y: localY / this.layerBounds.height
    };
  }

  /**
   * 转换归一化坐标为本地坐标
   * @param normalizedX 归一化X (0-1)
   * @param normalizedY 归一化Y (0-1)
   * @returns 本地坐标 {x, y} 或 null
   */
  public normalizedToLocal(normalizedX: number, normalizedY: number): { x: number; y: number } | null {
    if (!this.layerBounds) {
      return null;
    }
    return {
      x: normalizedX * this.layerBounds.width,
      y: normalizedY * this.layerBounds.height
    };
  }

  /**
   * 【对角计算】使用中心对称公式
   * 
   * 原理：在归一化空间中，对角的公式就是 (1-x, 1-y)
   * 这是图形编辑器的标准做法。
   * 
   * @param normalizedX 当前控制点的归一化X
   * @param normalizedY 当前控制点的归一化Y
   * @returns 对角的归一化坐标
   */
  public getOppositeCornerNormalized(normalizedX: number, normalizedY: number): { x: number; y: number } {
    return {
      x: 1 - normalizedX,
      y: 1 - normalizedY
    };
  }

  /**
   * 找出离本地点最近的角（仅角控制器，不包括边控制器）
   * 
   * @param localX 本地坐标 X
   * @param localY 本地坐标 Y
   * @returns 角索引 (0-3)，如果不接近任何角返回 -1
   */
  public findNearestCornerIndex(localX: number, localY: number, toleranceInNormalized: number = 0.1): number {
    if (!this.layerBounds) {
      return -1;
    }

    const normalizedX = localX / this.layerBounds.width;
    const normalizedY = localY / this.layerBounds.height;

    let minDistance = Infinity;
    let nearestCorner = -1;

    // 只检查4个角
    for (let i = 0; i < 4; i++) {
      const handle = this.NORMALIZED_HANDLES[i];
      const dx = normalizedX - handle.x;
      const dy = normalizedY - handle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < toleranceInNormalized && distance < minDistance) {
        minDistance = distance;
        nearestCorner = i;
      }
    }

    return nearestCorner;
  }

  /**
   * 获取本地坐标中某个角的坐标（用于兼容旧API）
   * 
   * @param cornerIndex 角索引 (0-3)
   * @returns 本地坐标 { x, y }
   */
  public getLocalCornerCoord(cornerIndex: number): { x: number; y: number } | null {
    if (!this.layerBounds) {
      return null;
    }

    const { width, height } = this.layerBounds;

    switch (cornerIndex) {
      case 0:
        return { x: 0, y: 0 };
      case 1:
        return { x: width, y: 0 };
      case 2:
        return { x: width, y: height };
      case 3:
        return { x: 0, y: height };
      default:
        return null;
    }
  }

  /**
   * 获取对角的本地坐标（用于兼容旧API）
   * 
   * @param cornerIndex 当前角的索引
   * @returns 对角的本地坐标 { x, y }
   */
  public getOppositeCornerCoord(cornerIndex: number): { x: number; y: number } | null {
    const currentCorner = this.getLocalCornerCoord(cornerIndex);
    if (!currentCorner || !this.layerBounds) {
      return null;
    }

    const { width, height } = this.layerBounds;
    const { x, y } = currentCorner;

    // 中心对称公式
    return {
      x: width - x,
      y: height - y
    };
  }

  /**
   * 清除缓存
   */
  public clearCache(): void {
    this.inverseMatrix = null;
    this.layerBounds = null;
    this.isMatrixCached = false;
    this.cachedMatrixHash = null;
  }

  /**
   * 检查是否已缓存
   */
  public isCached(): boolean {
    return this.isMatrixCached;
  }

  /**
   * 获取图层边界
   */
  public getLayerBounds(): { width: number; height: number } | null {
    return this.layerBounds;
  }

  /**
   * 计算 2x3 矩阵的逆矩阵
   * 
   * 矩阵格式: [a, b, c, d, e, f]
   * 表示的变换为:
   *   x' = a*x + c*y + e
   *   y' = b*x + d*y + f
   * 
   * @param matrix 原矩阵 [a, b, c, d, e, f]
   * @returns 逆矩阵 [a', b', c', d', e', f']，如果不可逆返回 null
   */
  private invertMatrix(matrix: number[]): number[] | null {
    const [a, b, c, d, e, f] = matrix;

    // 计算行列式
    const det = a * d - b * c;

    // 行列式为 0 表示矩阵不可逆
    if (Math.abs(det) < 1e-10) {
      return null;
    }

    // 计算逆矩阵
    const invDet = 1 / det;
    const a_inv = d * invDet;
    const b_inv = -b * invDet;
    const c_inv = -c * invDet;
    const d_inv = a * invDet;
    const e_inv = (c * f - d * e) * invDet;
    const f_inv = (b * e - a * f) * invDet;

    return [a_inv, b_inv, c_inv, d_inv, e_inv, f_inv];
  }
}

// 导出单例
export const localSpaceInteraction = new LocalSpaceInteraction();
