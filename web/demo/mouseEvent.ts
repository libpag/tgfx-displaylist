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

import { ShareData, animationLoop } from './common';
import { localSpaceInteraction } from './LocalSpaceInteraction';
/////

// ========== 交互常量配置 ==========
const InteractionConfig = {
    // 缩放限制
    MIN_ZOOM: 0.01,
    MAX_ZOOM: 1000.0,
    
    // 命中检测阈值（本地像素空间）
    CORNER_HIT_TOLERANCE_PIXELS: 30,  // 角控制器命中容差（本地像素）
    ROTATION_ZONE_TOLERANCE_PIXELS: 80, // 旋转区域最大距离（本地像素）
    
    // 框选相关
    BOX_SELECTION_MIN_DRAG: 20,      // 框选最小拖动距离（像素）
    BOX_SELECTION_MIN_PRESS: 300,    // 框选最小按压时间（毫秒）
    
    // 缩放变化阈值
    SCALE_CHANGE_THRESHOLD: 0.0001,  // 缩放变化检测阈值
    
    // 手势检测
    PINCH_TIMEOUT: 150,              // 捏合超时（毫秒）
    TIME_THRESHOLD: 50,              // 时间阈值（毫秒）
    DELTA_Y_THRESHOLD: 50,           // deltaY阈值
    DELTA_Y_CHANGE_THRESHOLD: 10,    // deltaY变化阈值
    MOUSE_WHEEL_RATIO: 800,          // 鼠标滚轮比率
    TOUCH_WHEEL_RATIO: 100,          // 触摸板滚轮比率
    
    // 旋转相关
    MIN_ROTATION_RADIUS_FACTOR: 0.25, // 最小旋转半径因子
    MIN_ABSOLUTE_RADIUS: 1e-3,        // 最小绝对半径
};

// 光标工厂类 - 负责创建和缓存光标
class CursorFactory {
    private static instance: CursorFactory;
    private cursorCache = new Map<string, string>();

    static getInstance(): CursorFactory {
        if (!CursorFactory.instance) {
            CursorFactory.instance = new CursorFactory();
        }
        return CursorFactory.instance;
    }

    // 创建方向箭头光标（支持旋转）
    private createArrowCursor(direction: string, rotationAngle: number = 0): string {
        // 基础方向对应的角度（度）- 箭头指向中心
        const baseAngles: { [key: string]: number } = {
            'nw-resize': 180,   // 左上角 → 向右指向中心
            'ne-resize': -90,   // 右上角 → 向下指向中心
            'se-resize': 0,     // 右下角 → 向左指向中心
            'sw-resize': 90     // 左下角 → 向上指向中心
        };

        const baseAngle = baseAngles[direction] || 0;
        const totalAngle = baseAngle + rotationAngle;

        // 创建旋转后的箭头 SVG
        const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(${totalAngle} 12 12)">
                <path d="M4 4L20 20" stroke="black" stroke-width="3"/>
                <path d="M20 20L14 20L20 14Z" fill="black"/>
            </g>
        </svg>`;

        const encoded = btoa(svg);
        return `url('data:image/svg+xml;base64,${encoded}') 12 12, auto`;
    }

    // 创建弧形旋转光标
    private createRotateCursor(): string {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d')!;

        // 设置样式
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        // 绘制上半部分弧形箭头（顺时针）
        ctx.beginPath();
        ctx.arc(12, 12, 9, -Math.PI/2, 0, false);
        ctx.stroke();

        // 绘制上半部分箭头
        ctx.beginPath();
        ctx.moveTo(18, 9);
        ctx.lineTo(21, 12);
        ctx.lineTo(18, 15);
        ctx.stroke();

        // 绘制下半部分弧形箭头（逆时针）
        ctx.beginPath();
        ctx.arc(12, 12, 9, Math.PI/2, Math.PI, false);
        ctx.stroke();

        // 绘制下半部分箭头
        ctx.beginPath();
        ctx.moveTo(6, 15);
        ctx.lineTo(3, 12);
        ctx.lineTo(6, 9);
        ctx.stroke();

        const dataUrl = canvas.toDataURL('image/png');
        return `url('${dataUrl}') 12 12, auto`;
    }

    // 获取光标（带缓存，支持旋转角度）
    getCursor(type: string, rotationAngle: number = 0): string {
        // 为旋转后的光标创建唯一的缓存键
        const cacheKey = rotationAngle !== 0 ? `${type}_${rotationAngle.toFixed(2)}` : type;
        
        if (this.cursorCache.has(cacheKey)) {
            return this.cursorCache.get(cacheKey)!;
        }

        let cursor: string;
        if (type === 'rotate') {
            cursor = this.createRotateCursor();
        } else if (['nw-resize', 'ne-resize', 'sw-resize', 'se-resize'].includes(type)) {
            // 将弧度转换为度
            const rotationDegrees = rotationAngle * 180 / Math.PI;
            cursor = this.createArrowCursor(type, rotationDegrees);
        } else {
            cursor = type; // 使用系统默认光标
        }

        this.cursorCache.set(cacheKey, cursor);
        return cursor;
    }

    // 清理缓存
    clearCache(): void {
        this.cursorCache.clear();
    }
}

// 坐标转换器类 - 统一处理坐标转换逻辑
class CoordinateTransformer {
    static screenToWorld(screenX: number, screenY: number, shareData: ShareData): {worldX: number, worldY: number} {
        const safeZoom = Math.max(shareData.zoom, InteractionConfig.MIN_ZOOM);
        const worldX = (screenX - shareData.offsetX) / safeZoom;
        const worldY = (screenY - shareData.offsetY) / safeZoom;
        return { worldX, worldY };
    }

    static worldToScreen(worldX: number, worldY: number, shareData: ShareData): {screenX: number, screenY: number} {
        const screenX = worldX * shareData.zoom + shareData.offsetX;
        const screenY = worldY * shareData.zoom + shareData.offsetY;
        return { screenX, screenY };
    }
}

// 简化的光标检测缓存类
class CursorDetectionCache {
    private lastFrameId = 0;
    private lastCursorType = 'default';

    detectCursorType(mouseX: number, mouseY: number, shareData: ShareData): string {
        const currentFrameId = performance.now() >> 4; // 约60fps的帧ID
        
        // 只在新帧时重新检测
        if (currentFrameId !== this.lastFrameId) {
            this.lastCursorType = this.performDetection(mouseX, mouseY, shareData);
            this.lastFrameId = currentFrameId;
        }
        
        return this.lastCursorType;
    }

    private performDetection(mouseX: number, mouseY: number, shareData: ShareData): string {
        if (!shareData.tgfxBaseView) return 'default';

        try {
            // 使用优化的坐标转换器
            const worldCoords = CoordinateTransformer.screenToWorld(mouseX, mouseY, shareData);
            
            // 检查是否处于多选模式
            const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                     (shareData.tgfxBaseView as any).isInMultiSelectionMode();

            // ========== 预先检测是否在选中图层内部（用于后续判断）==========
            let isInsideSelectionArea = false;
            if (isMultiSelection) {
                isInsideSelectionArea = this.isPointInMultiSelectionBounds(worldCoords.worldX, worldCoords.worldY, shareData);
            } else {
                isInsideSelectionArea = this.isPointInSelectedLayer(worldCoords.worldX, worldCoords.worldY, shareData);
            }

            // ========== 1. 首先检查角控制器（最高优先级）==========
            // 角控制器必须最先检测，因为它们可能位于图层边界上
            const cornerDetectionResult = this.detectCornerPosition(mouseX, mouseY, shareData);

            console.log(`[光标检测] 角检测结果:`, cornerDetectionResult, `在图层内:`, isInsideSelectionArea);

            if (cornerDetectionResult && typeof cornerDetectionResult === 'object') {
                const { position, localPixelDistance } = cornerDetectionResult;

                // 使用屏幕像素距离判断是否在角控制器上（缩放区域）
                // 缩放区域优先级最高，即使在图层内部也显示缩放光标
                if (localPixelDistance !== undefined && localPixelDistance < InteractionConfig.CORNER_HIT_TOLERANCE_PIXELS) {
                    // 返回缩放光标（基于用户看到的位置）
                    const cursorType = (() => {
                        switch (position) {
                            case '左上角': return 'nw-resize';
                            case '右上角': return 'ne-resize';
                            case '左下角': return 'sw-resize';
                            case '右下角': return 'se-resize';
                            default: return 'nw-resize';
                        }
                    })();
                    console.log(`[光标检测] → 返回缩放光标: ${cursorType}, 像素距离: ${localPixelDistance.toFixed(1)}`);
                    return cursorType;
                }
                
                // 检查是否在旋转区域（角控制器外围，30-80px）
                // 重要：如果在图层内部，不显示旋转光标，而是显示指针光标
                if (localPixelDistance !== undefined && 
                    localPixelDistance >= InteractionConfig.CORNER_HIT_TOLERANCE_PIXELS && 
                    localPixelDistance < InteractionConfig.ROTATION_ZONE_TOLERANCE_PIXELS) {
                    
                    // 如果在图层内部，不返回旋转光标
                    if (isInsideSelectionArea) {
                        console.log(`[光标检测] 在旋转区域但也在图层内部，跳过旋转光标`);
                        // 继续往下走，会返回 pointer
                    } else {
                        console.log(`[光标检测] → 返回旋转光标 (角附近), 像素距离: ${localPixelDistance.toFixed(1)}`);
                        return 'rotate';
                    }
                }
            }

            // ========== 2. 检查是否在选择边框上（显示移动光标）==========
            const isOnSelectionBorder = (shareData.tgfxBaseView as any).isPointInSelectionBorder &&
                (shareData.tgfxBaseView as any).isPointInSelectionBorder(worldCoords.worldX, worldCoords.worldY);

            console.log(`[光标检测] 选择边框: ${isOnSelectionBorder}`);

            if (isOnSelectionBorder) {
                console.log(`[光标检测] → 返回移动光标`);
                return 'move';
            }

            // ========== 3. 检查是否在选中图层内部 ==========
            if (isInsideSelectionArea) {
                // 在选中图层内部，显示指针光标
                console.log(`[光标检测] → 返回指针光标 (在图层内部)`);
                return 'pointer';
            }

            // ========== 4. 检查旋转区域（C++层的旋转区域检测，排除图层内部）==========
            const isInRotateZone = (shareData.tgfxBaseView as any).isPointInRotateZone &&
                (shareData.tgfxBaseView as any).isPointInRotateZone(worldCoords.worldX, worldCoords.worldY);

            console.log(`[光标检测] C++旋转区域: ${isInRotateZone}`);

            if (isInRotateZone) {
                console.log(`[光标检测] → 返回旋转光标 (C++区域)`);
                return 'rotate';
            }

            console.log(`[光标检测] → 返回默认光标`);
            return 'default';
        } catch (error) {
            console.error('[光标检测] 检测失败:', error);
            return 'default';
        }
    }

    /**
     * 检查点是否在选中图层内部
     * 
     * 使用选中图层的4个角坐标进行精确的多边形内点检测
     * 支持旋转的图层（非轴对齐）
     */
    private isPointInSelectedLayer(worldX: number, worldY: number, shareData: ShareData): boolean {
        if (!shareData.tgfxBaseView) return false;

        try {
            // 获取选中图层的4个角坐标
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                return false;
            }

            // 提取4个角的世界坐标
            const corners: { x: number; y: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1)
                });
            }

            // 使用射线法（Ray Casting）检测点是否在多边形内部
            // 这个方法支持任意凸多边形，包括旋转后的矩形
            return this.isPointInPolygon(worldX, worldY, corners);
        } catch (error) {
            console.error('检查选中图层失败:', error);
            return false;
        }
    }

    /**
     * 射线法检测点是否在多边形内部
     * 
     * 原理：从点向右发射一条射线，计算与多边形边的交点数
     * 如果交点数为奇数，则点在多边形内部
     */
    private isPointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
        let inside = false;
        const n = polygon.length;
        
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            
            // 检查射线是否与边相交
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }

    /**
     * 检查点是否在多选包围盒（AABB）内部
     * 
     * 多选模式下，需要检查点是否在整个选择框内部，而不仅仅是单个图层内部
     * 这样可以正确处理多选框内部的空白区域
     */
    private isPointInMultiSelectionBounds(worldX: number, worldY: number, shareData: ShareData): boolean {
        if (!shareData.tgfxBaseView) return false;

        try {
            // 获取多选包围盒的4个角
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                return false;
            }

            // 提取4个角的世界坐标
            const corners: { x: number; y: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1)
                });
            }

            // 计算AABB（轴对齐包围盒）
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            for (const corner of corners) {
                minX = Math.min(minX, corner.x);
                maxX = Math.max(maxX, corner.x);
                minY = Math.min(minY, corner.y);
                maxY = Math.max(maxY, corner.y);
            }

            // 检查点是否在AABB内部
            return worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY;
        } catch (error) {
            console.error('检查多选包围盒失败:', error);
            return false;
        }
    }

    // 【核心函数】检测具体是哪个角控制器
    // 直接使用屏幕像素距离进行命中测试，避免本地坐标缩放问题
    public detectCornerPosition(mouseX: number, mouseY: number, shareData: ShareData): { position: string; distance: number; localCornerIndex: number; localPixelDistance?: number } | null {
        if (!shareData.tgfxBaseView) {
            console.log('[角检测] tgfxBaseView 为空');
            return null;
        }

        try {
            // 检查是否处于多选模式
            const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                     (shareData.tgfxBaseView as any).isInMultiSelectionMode();

            console.log('[角检测] 多选模式:', isMultiSelection);

            // ========== 获取选中图层的4个角位置 ==========
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                console.log('[角检测] 无法获取选中图层角坐标');
                return null;
            }
            
            // 提取4个角的世界坐标
            const corners: { x: number; y: number; idx: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1),
                    idx: i
                });
            }
            
            // 获取鼠标的世界坐标
            const worldCoords = CoordinateTransformer.screenToWorld(mouseX, mouseY, shareData);
            
            console.log(`[角检测] 选中图层4角(世界坐标): 0:(${corners[0].x.toFixed(1)},${corners[0].y.toFixed(1)}) 1:(${corners[1].x.toFixed(1)},${corners[1].y.toFixed(1)}) 2:(${corners[2].x.toFixed(1)},${corners[2].y.toFixed(1)}) 3:(${corners[3].x.toFixed(1)},${corners[3].y.toFixed(1)})`);
            console.log(`[角检测] 鼠标世界坐标: (${worldCoords.worldX.toFixed(1)}, ${worldCoords.worldY.toFixed(1)}), 屏幕坐标: (${mouseX.toFixed(1)}, ${mouseY.toFixed(1)})`);
            
            // ========== 直接使用屏幕像素距离找最近的角 ==========
            let minScreenDistance = Infinity;
            let nearestCornerIdx = -1;
            
            const distances = corners.map((c, i) => {
                const dx = worldCoords.worldX - c.x;
                const dy = worldCoords.worldY - c.y;
                const worldDist = Math.sqrt(dx * dx + dy * dy);
                const screenDist = worldDist * shareData.zoom;
                
                if (screenDist < minScreenDistance) {
                    minScreenDistance = screenDist;
                    nearestCornerIdx = i;
                }
                
                return `角${i}:${screenDist.toFixed(1)}px`;
            });
            console.log(`[角检测] 鼠标到各角屏幕距离: ${distances.join(', ')}`);

            // 检查是否在最大检测范围内（使用旋转区域容差）
            if (minScreenDistance > InteractionConfig.ROTATION_ZONE_TOLERANCE_PIXELS) {
                console.log(`[角检测] 最近角距离 ${minScreenDistance.toFixed(1)}px 超出最大范围 ${InteractionConfig.ROTATION_ZONE_TOLERANCE_PIXELS}px`);
                return null;
            }

            if (isMultiSelection) {
                // ========== 多选模式：使用世界坐标直接检测 ==========
                return this.detectCornerPositionMultiSelection(mouseX, mouseY, shareData);
            }

            // ========== 单选模式：使用屏幕像素距离判断 ==========
            const localCornerIndex = nearestCornerIdx;
            
            // 获取该本地角的世界坐标，然后与选择框的4个角进行比较，找出视觉位置
            const visualPosition = this.localCornerToVisualPosition(localCornerIndex, shareData);

            // 计算归一化距离（用于兼容旧API）
            const diagonalLength = Math.hypot(
                corners[2].x - corners[0].x,
                corners[2].y - corners[0].y
            );
            const normalizedDistance = diagonalLength > 0 ? (minScreenDistance / shareData.zoom) / diagonalLength : 0;

            console.log(`[角检测] 命中角${localCornerIndex}(${visualPosition}), 屏幕距离:${minScreenDistance.toFixed(1)}px`);

            return { 
                position: visualPosition,  // 返回视觉位置名称
                distance: normalizedDistance,  // 归一化距离（保留兼容性）
                localCornerIndex: localCornerIndex,  // 同时返回本地索引，供缩放使用
                localPixelDistance: minScreenDistance  // 屏幕像素距离（用于判断缩放/旋转）
            };

        } catch (error) {
            console.error('[角检测] 异常:', error);
            // 出错时清除缓存
            localSpaceInteraction.clearCache();
            return null;
        }
    }

    /**
     * 多选模式的角检测
     * 
     * 多选模式下没有单一图层的逆矩阵，所以使用世界坐标直接检测
     * 直接比较鼠标世界坐标与选择框4个角的距离
     */
    private detectCornerPositionMultiSelection(mouseX: number, mouseY: number, shareData: ShareData): { position: string; distance: number; localCornerIndex: number; localPixelDistance?: number } | null {
        try {
            // 获取鼠标的世界坐标
            const worldCoords = CoordinateTransformer.screenToWorld(mouseX, mouseY, shareData);
            
            // 获取选择框的4个角的世界坐标
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                return null;
            }

            // 提取4个角的世界坐标
            const corners: { x: number; y: number; idx: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1),
                    idx: i
                });
            }

            // 计算选择框的对角线长度，用于归一化距离
            const diagonalLength = Math.hypot(
                corners[2].x - corners[0].x,
                corners[2].y - corners[0].y
            );
            
            if (diagonalLength < 1e-6) {
                return null;
            }

            // 找到最近的角
            let minDistance = Infinity;
            let nearestCornerIdx = -1;
            
            for (const corner of corners) {
                const dx = worldCoords.worldX - corner.x;
                const dy = worldCoords.worldY - corner.y;
                const distance = Math.hypot(dx, dy);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestCornerIdx = corner.idx;
                }
            }

            if (nearestCornerIdx < 0) {
                return null;
            }

            // 将距离归一化（相对于对角线长度）
            const normalizedDistance = minDistance / diagonalLength;
            
            // 计算世界像素距离（考虑缩放）
            // 多选模式下使用世界距离乘以缩放比例作为"本地像素距离"
            const worldPixelDistance = minDistance * shareData.zoom;

            // 使用排序方法判断视觉位置
            const targetCorner = corners[nearestCornerIdx];
            const sortedByX = [...corners].sort((a, b) => a.x - b.x);
            const leftCorners = [sortedByX[0], sortedByX[1]];
            const rightCorners = [sortedByX[2], sortedByX[3]];
            
            const isLeft = leftCorners.some(c => c.idx === nearestCornerIdx);
            
            let visualPosition: string;
            if (isLeft) {
                const leftSorted = leftCorners.sort((a, b) => a.y - b.y);
                const isTop = leftSorted[0].idx === nearestCornerIdx;
                visualPosition = isTop ? '左上角' : '左下角';
            } else {
                const rightSorted = rightCorners.sort((a, b) => a.y - b.y);
                const isTop = rightSorted[0].idx === nearestCornerIdx;
                visualPosition = isTop ? '右上角' : '右下角';
            }

            return {
                position: visualPosition,
                distance: normalizedDistance,
                localCornerIndex: nearestCornerIdx,  // 多选模式下这个就是世界坐标中的角索引
                localPixelDistance: worldPixelDistance  // 世界像素距离（考虑缩放）
            };

        } catch (error) {
            console.error('[光标检测-多选] 检测失败:', error);
            return null;
        }
    }

    /**
     * 将本地角索引转换为视觉位置名称
     * 
     * 原理：获取该本地角的世界坐标，然后根据其在所有角中的排序位置判断视觉位置
     * 使用排序而不是中心点比较，避免边界情况
     */
    private localCornerToVisualPosition(localCornerIndex: number, shareData: ShareData): string {
        try {
            // 获取所有4个角的世界坐标
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                // 无法获取角坐标，回退到本地名称
                const localNames = ['左上角', '右上角', '右下角', '左下角'];
                return localNames[localCornerIndex] || '未知';
            }

            // 提取4个角的世界坐标
            const corners: { x: number; y: number; localIdx: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1),
                    localIdx: i
                });
            }

            // 获取当前本地角的世界坐标
            const targetCorner = corners[localCornerIndex];
            if (!targetCorner) {
                return '未知';
            }

            // 使用排序方法判断视觉位置
            // 按 X 坐标排序，找出左侧和右侧的角
            const sortedByX = [...corners].sort((a, b) => a.x - b.x);
            const leftCorners = [sortedByX[0], sortedByX[1]];  // X 最小的两个
            const rightCorners = [sortedByX[2], sortedByX[3]]; // X 最大的两个
            
            // 判断目标角是在左侧还是右侧
            const isLeft = leftCorners.some(c => c.localIdx === localCornerIndex);
            
            // 在左侧或右侧的两个角中，按 Y 坐标判断上下
            if (isLeft) {
                // 在左侧两个角中找
                const leftSorted = leftCorners.sort((a, b) => a.y - b.y);
                const isTop = leftSorted[0].localIdx === localCornerIndex;
                return isTop ? '左上角' : '左下角';
            } else {
                // 在右侧两个角中找
                const rightSorted = rightCorners.sort((a, b) => a.y - b.y);
                const isTop = rightSorted[0].localIdx === localCornerIndex;
                return isTop ? '右上角' : '右下角';
            }
        } catch (error) {
            console.error('[光标检测] 转换视觉位置失败:', error);
            const localNames = ['左上角', '右上角', '右下角', '左下角'];
            return localNames[localCornerIndex] || '未知';
        }
    }
}

// 全局实例
const cursorFactory = CursorFactory.getInstance();
const cursorDetectionCache = new CursorDetectionCache();

// 设置光标样式（使用工厂模式）
// 注意：缩放光标不再需要旋转，因为 detectCornerPosition 已经返回了正确的视觉位置
// 视觉位置已经考虑了图层的所有变换（旋转、翻转），所以光标类型直接对应视觉方向
function setCursor(canvas: HTMLElement, cursorType: string, shareData?: ShareData) {
    // 缩放光标不再需要额外旋转，直接使用系统光标
    // 因为 cursorType 已经是基于视觉位置的（nw/ne/sw/se 对应视觉上的左上/右上/左下/右下）
    const cursor = cursorFactory.getCursor(cursorType, 0);
    canvas.style.cursor = cursor;
}

const MIN_ZOOM = InteractionConfig.MIN_ZOOM;
const MAX_ZOOM = InteractionConfig.MAX_ZOOM;

enum ScaleGestureState {
    SCALE_START = 0,
    SCALE_CHANGE = 1,
    SCALE_END = 2,
}

enum ScrollGestureState {
    SCROLL_START = 0,
    SCROLL_CHANGE = 1,
    SCROLL_END = 2,
}

enum DeviceType {
    TOUCH = 0,
    MOUSE = 1,
}

let isMouseDown = false;
let hasMoved = false;
let lastPointX = 0;
let lastPointY = 0;

// 缩放状态管理器
class ScaleStateManager {
    private static instance: ScaleStateManager;
    private isScaling = false;
    private lastPoint = { x: 0, y: 0 }; // 上一帧的鼠标位置
    private cachedCenter: { x: number, y: number } | null = null;
    private lastDistance = 0; // 上一帧的距离
    private cornerIndex = -1; // 0:左上, 1:右上, 2:右下, 3:左下
    private oppositeCornerLocal: { x: number, y: number } | null = null; // 对角点的本地坐标（不变）- 单选模式使用
    private oppositeCornerScreen: { x: number, y: number } | null = null; // 对角点的屏幕坐标（不变）- 多选模式使用
    private isMultiSelectionMode = false; // 是否为多选模式
    // 多选模式的翻转状态追踪（因为多选没有单一图层的翻转状态）
    private multiSelectionFlippedX = false;
    private multiSelectionFlippedY = false;
    
    // ========== 去旋转化策略所需的新字段 ==========
    private cachedRotation = 0; // 缓存的旋转角度（弧度）
    private initialLocalWidth = 0; // 初始局部宽度（从锚点到操作点）
    private initialLocalHeight = 0; // 初始局部高度（从锚点到操作点）
    private anchorWorldCoord: { x: number, y: number } | null = null; // 锚点的世界坐标（缓存）

    static getInstance(): ScaleStateManager {
        if (!ScaleStateManager.instance) {
            ScaleStateManager.instance = new ScaleStateManager();
        }
        return ScaleStateManager.instance;
    }

    startScaling(startX: number, startY: number, centerX: number, centerY: number, cornerIdx: number, localX: number, localY: number, isMultiSelection = false, screenX?: number, screenY?: number, shareData?: ShareData): void {
        this.isScaling = true;
        this.lastPoint = { x: startX, y: startY };
        this.cachedCenter = { x: centerX, y: centerY };
        this.cornerIndex = cornerIdx;  // 存储视觉位置索引，用于翻转判断
        this.isMultiSelectionMode = isMultiSelection; // 记录模式
        
        const cornerNames = ['左上角', '右上角', '右下角', '左下角'];
        const cornerName = cornerNames[cornerIdx] || '未知';
        
        if (isMultiSelection) {
            // 多选模式：缓存对角点的屏幕坐标
            this.oppositeCornerScreen = { x: screenX!, y: screenY! };
            this.oppositeCornerLocal = null;
            this.multiSelectionFlippedX = false;
            this.multiSelectionFlippedY = false;
            console.log(`[缩放开始] 多选模式，操作角：${cornerName}(索引${cornerIdx})`);
        } else {
            // 单选模式：缓存对角点的本地坐标
            this.oppositeCornerLocal = { x: localX, y: localY };
            this.oppositeCornerScreen = null;
            
            // 缓存锚点的世界坐标
            this.anchorWorldCoord = { x: centerX, y: centerY };
            
            // 获取旋转角度
            if (shareData && shareData.tgfxBaseView) {
                this.cachedRotation = (shareData.tgfxBaseView as any).getSelectedLayerRotation() || 0;
            } else {
                this.cachedRotation = 0;
            }
            
            // 计算初始的局部宽高（将世界向量逆旋转到局部坐标系）
            const worldDiffX = startX - centerX;
            const worldDiffY = startY - centerY;
            const cos = Math.cos(-this.cachedRotation);
            const sin = Math.sin(-this.cachedRotation);
            this.initialLocalWidth = worldDiffX * cos - worldDiffY * sin;
            this.initialLocalHeight = worldDiffX * sin + worldDiffY * cos;
            
            console.log(`[缩放开始] 单选模式，操作角：${cornerName}(视觉索引${cornerIdx})，旋转：${(this.cachedRotation * 180 / Math.PI).toFixed(1)}°`);
        }

        const deltaX = startX - centerX;
        const deltaY = startY - centerY;
        this.lastDistance = Math.hypot(deltaX, deltaY);
    }
    
    // 获取缓存的旋转角度
    getCachedRotation(): number {
        return this.cachedRotation;
    }
    
    // 获取初始局部宽高
    getInitialLocalSize(): { width: number, height: number } {
        return { width: this.initialLocalWidth, height: this.initialLocalHeight };
    }
    
    // 获取锚点世界坐标
    getAnchorWorldCoord(): { x: number, y: number } | null {
        return this.anchorWorldCoord;
    }

    /**
     * 初始化本地空间交互（新架构）
     * 在点击时调用，缓存逆矩阵和边界信息
     */
    public initializeLocalSpaceInteraction(shareData: ShareData): boolean {
        if (!shareData || !shareData.tgfxBaseView) {
            console.error('[缩放状态] 无法初始化 LocalSpaceInteraction：shareData 或 tgfxBaseView 为空');
            return false;
        }
        
        // 缓存逆矩阵和边界信息（仅在单选模式）
        if (!this.isMultiSelectionMode) {
            return localSpaceInteraction.cacheInverseMatrix(shareData);
        }
        
        return true;
    }
    
    /**
     * 根据本地空间坐标找出当前操作的角
     */
    public findCornerByLocalCoord(localX: number, localY: number): number {
        return localSpaceInteraction.findNearestCornerIndex(localX, localY, 20);
    }
    
    /**
     * 清除本地空间交互缓存
     */
    public clearLocalSpaceCache(): void {
        localSpaceInteraction.clearCache();
    }

    endScaling(): void {
        this.isScaling = false;
        this.cachedCenter = null;
        this.cornerIndex = -1;
        this.lastDistance = 0;
        this.oppositeCornerLocal = null;
        this.oppositeCornerScreen = null;
        this.isMultiSelectionMode = false;
        this.multiSelectionFlippedX = false;
        this.multiSelectionFlippedY = false;
        // 重置单选翻转状态
        this.singleSelectionFlippedX = false;
        this.singleSelectionFlippedY = false;
        // 重置去旋转化字段
        this.cachedRotation = 0;
        this.initialLocalWidth = 0;
        this.initialLocalHeight = 0;
        this.anchorWorldCoord = null;
        this.lastLocalWidth = 0;
        this.lastLocalHeight = 0;
        
        // 清除本地空间缓存
        this.clearLocalSpaceCache();
    }

    isInScaling(): boolean {
        return this.isScaling;
    }

    getCachedCenter(): { x: number, y: number } | null {
        return this.cachedCenter;
    }

    getCornerIndex(): number {
        return this.cornerIndex;
    }

    getOppositeCornerLocal(): { x: number, y: number } | null {
        return this.oppositeCornerLocal;
    }

    getOppositeCornerScreen(): { x: number, y: number } | null {
        return this.oppositeCornerScreen;
    }

    // 多选模式专用：计算等比例缩放，支持翻转检测
    calculateMultiSelectionScale(currentX: number, currentY: number, oppositeCenterX: number, oppositeCenterY: number): { scaleX: number, scaleY: number } {
        const deltaX = currentX - oppositeCenterX;
        const deltaY = currentY - oppositeCenterY;
        
        // 判断是否应该翻转（基于鼠标相对对角点的位置）
        const shouldFlipX = this.shouldFlipX(currentX, oppositeCenterX);
        const shouldFlipY = this.shouldFlipY(currentY, oppositeCenterY);
        
        // 根据翻转状态调整向量方向，计算有效距离
        const effectiveDeltaX = shouldFlipX ? -deltaX : deltaX;
        const effectiveDeltaY = shouldFlipY ? -deltaY : deltaY;
        const currentDistance = Math.hypot(effectiveDeltaX, effectiveDeltaY);
        
        if (this.lastDistance === 0) {
            this.lastDistance = currentDistance;
            return { scaleX: 1.0, scaleY: 1.0 };
        }
        
        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // 检查是否需要翻转
        const needFlipX = shouldFlipX !== this.multiSelectionFlippedX;
        const needFlipY = shouldFlipY !== this.multiSelectionFlippedY;
        
        if (needFlipX || needFlipY) {
            // 发生翻转
            if (needFlipX) {
                scaleX = -1.0;
                this.multiSelectionFlippedX = shouldFlipX;
            }
            if (needFlipY) {
                scaleY = -1.0;
                this.multiSelectionFlippedY = shouldFlipY;
            }
            console.log(`[翻转] 多选模式 X:${needFlipX} Y:${needFlipY}`);
            
            // 同步翻转状态到旋转管理器
            rotationStateManager.setMultiSelectionFlipState(this.multiSelectionFlippedX, this.multiSelectionFlippedY);
            
            this.lastDistance = Math.max(currentDistance, Number.EPSILON);
        } else {
            // 没有翻转，正常计算缩放因子
            const scaleFactor = currentDistance / this.lastDistance;
            scaleX = scaleFactor;
            scaleY = scaleFactor;
            this.lastDistance = currentDistance;
        }
        
        this.lastPoint = { x: currentX, y: currentY };
        
        return { scaleX, scaleY };
    }

    // 单选模式翻转状态追踪
    private singleSelectionFlippedX = false;
    private singleSelectionFlippedY = false;
    // 去旋转化：上一帧的局部宽高
    private lastLocalWidth = 0;
    private lastLocalHeight = 0;

    /**
     * 计算增量缩放因子
     * 
     * 简化策略：直接使用世界坐标中鼠标到对角点的距离变化来计算缩放因子
     * 翻转检测基于鼠标是否越过对角点
     */
    calculateIncrementalScaleFactor(currentX: number, currentY: number, oppositeCenterX: number, oppositeCenterY: number): { scaleX: number, scaleY: number } {
        // 1. 计算当前鼠标相对于对角点的向量
        const deltaX = currentX - oppositeCenterX;
        const deltaY = currentY - oppositeCenterY;
        
        // 2. 检测翻转（基于鼠标相对于对角点的位置）
        const shouldFlipX = this.shouldFlipX(currentX, oppositeCenterX);
        const shouldFlipY = this.shouldFlipY(currentY, oppositeCenterY);
        
        // 3. 根据翻转状态调整向量方向，计算有效距离
        const effectiveDeltaX = shouldFlipX ? -deltaX : deltaX;
        const effectiveDeltaY = shouldFlipY ? -deltaY : deltaY;
        const currentDistance = Math.hypot(effectiveDeltaX, effectiveDeltaY);
        
        // 4. 初始化
        if (this.lastDistance === 0) {
            this.lastDistance = currentDistance;
            this.singleSelectionFlippedX = false;
            this.singleSelectionFlippedY = false;
            return { scaleX: 1.0, scaleY: 1.0 };
        }
        
        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // 5. 检查是否需要翻转
        const needFlipX = shouldFlipX !== this.singleSelectionFlippedX;
        const needFlipY = shouldFlipY !== this.singleSelectionFlippedY;
        
        if (needFlipX || needFlipY) {
            // 发生翻转
            if (needFlipX) {
                scaleX = -1.0;
                this.singleSelectionFlippedX = shouldFlipX;
            }
            if (needFlipY) {
                scaleY = -1.0;
                this.singleSelectionFlippedY = shouldFlipY;
            }
            console.log(`[翻转] 单选模式 X:${needFlipX} Y:${needFlipY}`);
            
            // 翻转后重置距离基准
            this.lastDistance = Math.max(currentDistance, Number.EPSILON);
        } else {
            // 6. 没有翻转，正常计算缩放因子
            if (this.lastDistance > Number.EPSILON) {
                const scaleFactor = currentDistance / this.lastDistance;
                scaleX = scaleFactor;
                scaleY = scaleFactor;
            }
            this.lastDistance = currentDistance;
        }
        
        this.lastPoint = { x: currentX, y: currentY };
        
        return { scaleX, scaleY };
    }
    
    // 旧的缩放计算方法（作为回退）- 不再需要，保留以防万一
    private calculateIncrementalScaleFactorLegacy(currentX: number, currentY: number, oppositeCenterX: number, oppositeCenterY: number): { scaleX: number, scaleY: number } {
        const deltaX = currentX - oppositeCenterX;
        const deltaY = currentY - oppositeCenterY;
        const currentDistance = Math.hypot(deltaX, deltaY);
        
        if (this.lastDistance === 0) {
            this.lastDistance = currentDistance;
            return { scaleX: 1.0, scaleY: 1.0 };
        }
        
        const scaleFactor = currentDistance / this.lastDistance;
        this.lastDistance = currentDistance;
        this.lastPoint = { x: currentX, y: currentY };
        
        return { scaleX: scaleFactor, scaleY: scaleFactor };
    }
    
    // 检测X轴是否应该翻转（基于当前鼠标相对于中心点的位置）
    // cornerIndex 现在是视觉索引：0=视觉左上, 1=视觉右上, 2=视觉右下, 3=视觉左下
    private shouldFlipX(currentX: number, centerX: number): boolean {
        // 基于视觉位置判断翻转
        // 视觉左侧操作（视觉左上0、视觉左下3）-> 鼠标在固定点右侧时翻转
        // 视觉右侧操作（视觉右上1、视觉右下2）-> 鼠标在固定点左侧时翻转
        const isVisualLeftCorner = (this.cornerIndex === 0 || this.cornerIndex === 3);
        
        if (isVisualLeftCorner) {
            return currentX > centerX;
        } else {
            return currentX < centerX;
        }
    }
    
    // 检测Y轴是否应该翻转（基于当前鼠标相对于中心点的位置）
    // cornerIndex 现在是视觉索引：0=视觉左上, 1=视觉右上, 2=视觉右下, 3=视觉左下
    private shouldFlipY(currentY: number, centerY: number): boolean {
        // 基于视觉位置判断翻转
        // 视觉上侧操作（视觉左上0、视觉右上1）-> 鼠标在固定点下方时翻转
        // 视觉下侧操作（视觉右下2、视觉左下3）-> 鼠标在固定点上方时翻转
        const isVisualTopCorner = (this.cornerIndex === 0 || this.cornerIndex === 1);
        
        if (isVisualTopCorner) {
            return currentY > centerY;
        } else {
            return currentY < centerY;
        }
    }
}

const scaleStateManager = ScaleStateManager.getInstance();

// ========== 框选管理器 ==========
class BoxSelectionManager {
    private isSelecting = false;
    private hasDragStarted = false;
    private isPrepared = false;
    private startScreenX = 0;
    private startScreenY = 0;
    private startWorldX = 0;
    private startWorldY = 0;
    private minDragDistance = InteractionConfig.BOX_SELECTION_MIN_DRAG;
    private minPressTime = InteractionConfig.BOX_SELECTION_MIN_PRESS;
    private pressStartTime = 0;

    // 记录初始点击位置（只在点击空白区域时调用）
    onMouseDown(screenX: number, screenY: number, worldX: number, worldY: number): void {
        this.startScreenX = screenX;
        this.startScreenY = screenY;
        this.startWorldX = worldX;
        this.startWorldY = worldY;
        this.hasDragStarted = false;
        this.isPrepared = true;
        this.pressStartTime = Date.now();
    }

    // 判断是否应该启动框选
    onMouseMove(currentScreenX: number, currentScreenY: number, worldX: number, worldY: number, shareData: ShareData): void {
        if (!this.isPrepared) {
            return;
        }
        
        const dx = currentScreenX - this.startScreenX;
        const dy = currentScreenY - this.startScreenY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const pressDuration = Date.now() - this.pressStartTime;

        if (!this.hasDragStarted && (distance > this.minDragDistance || pressDuration > this.minPressTime)) {
            this.hasDragStarted = true;
            this.isSelecting = true;
            
            (shareData.tgfxBaseView as any).resetSelectedLayer();
            (shareData.tgfxBaseView as any).startBoxSelection(this.startWorldX, this.startWorldY);
        }

        if (this.isSelecting) {
            (shareData.tgfxBaseView as any).updateBoxSelection(worldX, worldY);
        }
    }

    // 鼠标抬起
    onMouseUp(shareData: ShareData): void {
        if (this.isSelecting) {
            (shareData.tgfxBaseView as any).endBoxSelection();
            shareData.tgfxBaseView?.markDirty();
        }

        this.isSelecting = false;
        this.hasDragStarted = false;
        this.isPrepared = false;
    }

    isBoxSelecting(): boolean {
        return this.isSelecting;
    }

    reset(): void {
        this.isSelecting = false;
        this.hasDragStarted = false;
        this.isPrepared = false;
        this.startScreenX = 0;
        this.startScreenY = 0;
        this.startWorldX = 0;
        this.startWorldY = 0;
        this.pressStartTime = 0;
    }

    // 获取当前是否在框选过程中（用于外部检查）
    isPreparedForBoxSelection(): boolean {
        return this.isPrepared;
    }
}

const boxSelectionManager = new BoxSelectionManager();

class RotationStateManager {
    private static instance: RotationStateManager;
    private isRotating = false;
    private lastPoint = { x: 0, y: 0 };
    private cachedCenter: { x: number, y: number } | null = null;
    private totalRotation = 0; // 累积旋转角度（弧度）
    private cachedDistance = 0;
    private lastSelectedLayerId: string = ''; // 记录上次选中的图层ID
    private isMultiSelectionMode = false; // 是否为多选模式
    // 多选模式的翻转状态追踪
    private multiSelectionFlippedX = false;
    private multiSelectionFlippedY = false;

    static getInstance(): RotationStateManager {
        if (!RotationStateManager.instance) {
            RotationStateManager.instance = new RotationStateManager();
        }
        return RotationStateManager.instance;
    }

    startRotation(startX: number, startY: number, centerX: number, centerY: number, currentLayerId?: string): void {
        const isMultiSelection = currentLayerId === '__MULTI_SELECTION__';
        
        if (currentLayerId && currentLayerId !== this.lastSelectedLayerId) {
            this.totalRotation = 0;
            this.lastSelectedLayerId = currentLayerId;
            
            if (isMultiSelection) {
                this.multiSelectionFlippedX = false;
                this.multiSelectionFlippedY = false;
            }
        }
        
        this.isRotating = true;
        this.isMultiSelectionMode = isMultiSelection;
        this.lastPoint = { x: startX, y: startY };
        this.cachedCenter = { x: centerX, y: centerY };
        this.cachedDistance = Math.hypot(startX - centerX, startY - centerY);
    }

    endRotation(): void {
        this.isRotating = false;
        this.cachedCenter = null;
        this.cachedDistance = 0;
        this.isMultiSelectionMode = false;
        this.multiSelectionFlippedX = false;
        this.multiSelectionFlippedY = false;
        
        localSpaceInteraction.clearCache();
    }

    isInRotation(): boolean {
        return this.isRotating;
    }

    getCachedCenter(): { x: number, y: number } | null {
        return this.cachedCenter;
    }

    getCachedRadius(): number {
        return this.cachedDistance;
    }

    setFallbackCenter(centerX: number, centerY: number): void {
        this.cachedCenter = { x: centerX, y: centerY };
    }
    
    // 设置多选翻转状态（在缩放时调用）
    setMultiSelectionFlipState(flipX: boolean, flipY: boolean): void {
        this.multiSelectionFlippedX = flipX;
        this.multiSelectionFlippedY = flipY;
    }

    // 计算增量旋转角度
    calculateIncrementalRotationAngle(currentX: number, currentY: number, shareData?: ShareData): number {
        if (!this.cachedCenter) {
            console.error('[旋转] 缓存中心点为空');
            return 0;
        }

        const centerX = this.cachedCenter.x;
        const centerY = this.cachedCenter.y;
        const lastX = this.lastPoint.x;
        const lastY = this.lastPoint.y;
        
        const lastVector = { x: lastX - centerX, y: lastY - centerY };
        const currentVector = { x: currentX - centerX, y: currentY - centerY };

        const lastRadius = Math.hypot(lastVector.x, lastVector.y);
        const currentRadius = Math.hypot(currentVector.x, currentVector.y);
        const fallbackRadius = Math.max(this.cachedDistance, Number.EPSILON);
        const minRadius = Math.max(fallbackRadius * InteractionConfig.MIN_ROTATION_RADIUS_FACTOR, InteractionConfig.MIN_ABSOLUTE_RADIUS);
        if (lastRadius < minRadius || currentRadius < minRadius) {
            console.warn('[旋转] 半径过小，忽略此次旋转增量');
            return 0;
        }
        
        const lastAngle = Math.atan2(lastVector.y, lastVector.x);
        const currentAngle = Math.atan2(currentVector.y, currentVector.x);
        
        let deltaAngle = currentAngle - lastAngle;
        
        if (deltaAngle > Math.PI) {
            deltaAngle -= 2 * Math.PI;
        } else if (deltaAngle < -Math.PI) {
            deltaAngle += 2 * Math.PI;
        }

        // 获取翻转状态（单选/多选分别处理）
        let isFlippedX = false;
        let isFlippedY = false;
        
        if (this.isMultiSelectionMode) {
            isFlippedX = this.multiSelectionFlippedX;
            isFlippedY = this.multiSelectionFlippedY;
        } else if (shareData) {
            const flipStateVector = (shareData.tgfxBaseView as any).getSelectedLayerFlipState();
            if (flipStateVector && flipStateVector.size && flipStateVector.size() >= 2) {
                isFlippedX = flipStateVector.get(0) > 0.5;
                isFlippedY = flipStateVector.get(1) > 0.5;
            }
        }
        
        // 只有当有奇数个轴翻转时，才需要反转旋转方向
        if ((isFlippedX && !isFlippedY) || (isFlippedY && !isFlippedX)) {
            deltaAngle = -deltaAngle;
        }

        this.totalRotation += deltaAngle;
        this.lastPoint = { x: currentX, y: currentY };
        
        return deltaAngle;
    }
}

const rotationStateManager = RotationStateManager.getInstance();

function ConvertCoordinates(e: MouseEvent, canvas: HTMLElement) {
    const rect = canvas.getBoundingClientRect();
    return {
        clientX: (e.clientX - rect.left) * window.devicePixelRatio,
        clientY: (e.clientY - rect.top) * window.devicePixelRatio
    };
}



export type ZoomChangeCallback = (zoom: number) => void;

export class GestureManager {
    private scaleY = 1.0;
    private zoomChangeCallbacks: ZoomChangeCallback[] = [];
    private pinchTimeout = InteractionConfig.PINCH_TIMEOUT;
    private timer: number | undefined;
    private scaleStartZoom = 1.0;

    private lastEventTime = 0;
    private lastDeltaY = 0;
    private timeThreshold = InteractionConfig.TIME_THRESHOLD;
    private deltaYThreshold = InteractionConfig.DELTA_Y_THRESHOLD;
    private deltaYChangeThreshold = InteractionConfig.DELTA_Y_CHANGE_THRESHOLD;
    private mouseWheelRatio = InteractionConfig.MOUSE_WHEEL_RATIO;
    private touchWheelRatio = InteractionConfig.TOUCH_WHEEL_RATIO;

    private handleScrollEvent(
        event: WheelEvent,
        state: ScrollGestureState,
        shareData: ShareData,
        deviceType: DeviceType = DeviceType.MOUSE,
    ) {
        if (state === ScrollGestureState.SCROLL_CHANGE) {
            this.scaleStartZoom = shareData.zoom;
            this.scaleY = 1.0;
            if (event.shiftKey && event.deltaX === 0 && event.deltaY !== 0) {
                shareData.offsetX -= event.deltaY * window.devicePixelRatio;
            } else {
                shareData.offsetX -= event.deltaX * window.devicePixelRatio;
                shareData.offsetY -= event.deltaY * window.devicePixelRatio;
            }
        }
    }

    private handleScaleEvent(
        event: WheelEvent,
        state: ScaleGestureState,
        canvas: HTMLElement,
        shareData: ShareData,
        deviceType: DeviceType = DeviceType.MOUSE
    ) {
        if (state === ScaleGestureState.SCALE_START) {
            this.scaleY = 1.0;
            this.scaleStartZoom = shareData.zoom;
        }
        if (state === ScaleGestureState.SCALE_CHANGE) {
            const rect = canvas.getBoundingClientRect();
            const pixelX = (event.clientX - rect.left) * window.devicePixelRatio;
            const pixelY = (event.clientY - rect.top) * window.devicePixelRatio;
            const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.scaleStartZoom * this.scaleY));
            shareData.offsetX = (shareData.offsetX - pixelX) * (newZoom / shareData.zoom) + pixelX;
            shareData.offsetY = (shareData.offsetY - pixelY) * (newZoom / shareData.zoom) + pixelY;
            shareData.zoom = newZoom;
            this.notifyZoomChange(newZoom);
        }
        if (state === ScaleGestureState.SCALE_END) {
            this.scaleY = 1.0;
            this.scaleStartZoom = shareData.zoom;
        }
    }

    public onZoomChange(callback: ZoomChangeCallback) {
        this.zoomChangeCallbacks.push(callback);
    }

    private notifyZoomChange(zoom: number) {
        this.zoomChangeCallbacks.forEach(cb => cb(zoom));
    }

    public clearState() {
        this.scaleY = 1.0;
        this.timer = undefined;
    }

    // 处理旋转操作
    private handleRotation(currentX: number, currentY: number, shareData: ShareData) {
        if (!shareData.tgfxBaseView) {
            console.error('[旋转JS] shareData.tgfxBaseView 为空');
            return;
        }

        try {
            // 使用缓存的中心点，避免重复计算
            const cachedCenter = rotationStateManager.getCachedCenter();
            if (!cachedCenter) {
                console.error('[旋转JS] 缓存中心点为空，无法继续旋转');
                return;
            }

            // 将当前屏幕坐标转换为世界坐标
            const currentWorldCoords = CoordinateTransformer.screenToWorld(currentX, currentY, shareData);

            const radius = rotationStateManager.getCachedRadius();
            const currentRadius = Math.hypot(
                currentWorldCoords.worldX - cachedCenter.x,
                currentWorldCoords.worldY - cachedCenter.y
            );
            const minimumUsableRadius = Math.max(radius * InteractionConfig.MIN_ROTATION_RADIUS_FACTOR, InteractionConfig.MIN_ABSOLUTE_RADIUS);
            if (currentRadius < minimumUsableRadius) {
                console.warn('[旋转JS] 当前半径过小，忽略旋转');
                return;
            }

            // 计算增量旋转角度（使用缓存的中心点）
            const deltaAngle = rotationStateManager.calculateIncrementalRotationAngle(
                currentWorldCoords.worldX, currentWorldCoords.worldY, shareData
            );
            
            if (Math.abs(deltaAngle) > 0) {
                const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                         (shareData.tgfxBaseView as any).isInMultiSelectionMode();
                
                if (isMultiSelection) {
                    (shareData.tgfxBaseView as any).rotateMultiSelection(deltaAngle);
                } else {
                    (shareData.tgfxBaseView as any).rotateSelectedLayer(deltaAngle, Number.NaN, Number.NaN);
                }
                
                shareData.tgfxBaseView?.markDirty();
            }

        } catch (error) {
            console.error('[旋转JS] 旋转操作失败:', error);
        }
    }

    // 处理缩放操作
    private handleScaling(currentX: number, currentY: number, shareData: ShareData): void {
        try {
            const cornerIdx = scaleStateManager.getCornerIndex();
            if (cornerIdx < 0) {
                console.error('[缩放JS] 角索引无效');
                return;
            }

            // 检测是否处于多选模式
            const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                     (shareData.tgfxBaseView as any).isInMultiSelectionMode();
            
            let oppositeCenterX: number;
            let oppositeCenterY: number;
            let scaleFactors: { scaleX: number, scaleY: number };
            
            if (isMultiSelection) {
                // 多选模式：使用缓存的屏幕坐标，每帧转换为世界坐标
                const oppositeCornerScreen = scaleStateManager.getOppositeCornerScreen();
                if (!oppositeCornerScreen) {
                    console.error('[缩放JS-多选] 无法获取对角点屏幕坐标');
                    return;
                }
                
                // 将屏幕坐标转换为当前的世界坐标
                const oppositeWorldCoords = CoordinateTransformer.screenToWorld(
                    oppositeCornerScreen.x, oppositeCornerScreen.y, shareData
                );
                oppositeCenterX = oppositeWorldCoords.worldX;
                oppositeCenterY = oppositeWorldCoords.worldY;
                
                // 多选模式使用简化的缩放计算
                scaleFactors = scaleStateManager.calculateMultiSelectionScale(
                    currentX, currentY, oppositeCenterX, oppositeCenterY
                );
            } else {
                // ========== 单选模式：需要实时转换本地坐标 ==========
                // 获取对角点的本地坐标（缓存的，不会变）
                const localCorner = scaleStateManager.getOppositeCornerLocal();
                if (!localCorner) {
                    console.error('[缩放JS-单选] 无法获取对角点本地坐标');
                    return;
                }

                // 将本地坐标转换为当前的世界坐标（用于计算距离）
                const worldCornerVector = (shareData.tgfxBaseView as any).localToWorldCoords(localCorner.x, localCorner.y);
                if (!worldCornerVector || typeof worldCornerVector.size !== 'function' || worldCornerVector.size() < 2) {
                    console.error('[缩放JS-单选] 无法转换对角点坐标');
                    return;
                }

                oppositeCenterX = worldCornerVector.get(0);
                oppositeCenterY = worldCornerVector.get(1);
                
                // 单选模式使用完整的缩放计算（支持翻转）
                scaleFactors = scaleStateManager.calculateIncrementalScaleFactor(
                    currentX, currentY, oppositeCenterX, oppositeCenterY
                );
            }
            
            if (Math.abs(scaleFactors.scaleX - 1.0) > InteractionConfig.SCALE_CHANGE_THRESHOLD || 
                Math.abs(scaleFactors.scaleY - 1.0) > InteractionConfig.SCALE_CHANGE_THRESHOLD) {
                if (isMultiSelection) {
                    (shareData.tgfxBaseView as any).scaleMultiSelection(
                        scaleFactors.scaleX, scaleFactors.scaleY, oppositeCenterX, oppositeCenterY
                    );
                } else {
                    const localCorner = scaleStateManager.getOppositeCornerLocal()!;
                    (shareData.tgfxBaseView as any).scaleSelectedLayerWithLocalPivot(
                        scaleFactors.scaleX, scaleFactors.scaleY, localCorner.x, localCorner.y
                    );
                }
                
                shareData.tgfxBaseView?.markDirty();
            }

        } catch (error) {
            console.error('[缩放JS] 缩放操作失败:', error);
        }
    }

    private resetScrollTimeout(
        event: WheelEvent,
        shareData: ShareData,
        deviceType: DeviceType = DeviceType.MOUSE
    ) {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.handleScrollEvent(event, ScrollGestureState.SCROLL_END, shareData, deviceType);
            this.clearState();
        }, this.pinchTimeout);
    }

    private resetScaleTimeout(
        event: WheelEvent,
        canvas: HTMLElement,
        shareData: ShareData,
        deviceType: DeviceType = DeviceType.MOUSE
    ) {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.handleScaleEvent(event, ScaleGestureState.SCALE_END, canvas, shareData, deviceType);
            this.clearState();
        }, this.pinchTimeout);
    }

    private getDeviceType(event: WheelEvent): DeviceType {
        const now = Date.now();
        const timeDifference = now - this.lastEventTime;
        const deltaYChange = Math.abs(event.deltaY - this.lastDeltaY);
        let isTouchpad = false;
        if (event.deltaMode === event.DOM_DELTA_PIXEL && timeDifference < this.timeThreshold) {
            if (Math.abs(event.deltaY) < this.deltaYThreshold && deltaYChange < this.deltaYChangeThreshold) {
                isTouchpad = true;
            }
        }
        this.lastEventTime = now;
        this.lastDeltaY = event.deltaY;
        return isTouchpad ? DeviceType.TOUCH : DeviceType.MOUSE;
    }

    public onWheel(event: WheelEvent, canvas: HTMLElement, shareData: ShareData) {
        const deviceType = this.getDeviceType(event);
        let wheelRatio = (deviceType === DeviceType.MOUSE ? this.mouseWheelRatio : this.touchWheelRatio);

        if (!event.deltaY || (!event.ctrlKey && !event.metaKey)) {
            this.resetScrollTimeout(event, shareData, deviceType);
            this.handleScrollEvent(event, ScrollGestureState.SCROLL_CHANGE, shareData, deviceType);
            // 标记脏并触发动画循环
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
            return;
        }
        this.scaleY *= Math.exp(-(event.deltaY) / wheelRatio);
        if (!this.timer) {
            this.resetScaleTimeout(event, canvas, shareData, deviceType);
            this.handleScaleEvent(event, ScaleGestureState.SCALE_START, canvas, shareData, deviceType);
        } else {
            this.resetScaleTimeout(event, canvas, shareData, deviceType);
            this.handleScaleEvent(event, ScaleGestureState.SCALE_CHANGE, canvas, shareData, deviceType);
        }
        // 标记脏并触发动画循环
        shareData.tgfxBaseView?.markDirty();
        animationLoop(shareData);
    }

    public onMouseMove(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        const clientXY = ConvertCoordinates(event, canvas);

        // 优先处理缩放
        if (scaleStateManager.isInScaling()) {
            const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
            this.handleScaling(worldCoords.worldX, worldCoords.worldY, shareData);
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
            return;
        }

        // 处理旋转
        if (rotationStateManager.isInRotation()) {
            this.handleRotation(clientXY.clientX, clientXY.clientY, shareData);
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
            return;
        }

        // 处理普通拖动移动（包括框选）
        if (isMouseDown) {
            const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
            
            // 检查是否应该启动框选或更新框选
            boxSelectionManager.onMouseMove(
                clientXY.clientX, clientXY.clientY,
                worldCoords.worldX, worldCoords.worldY,
                shareData
            );
            
            if (boxSelectionManager.isBoxSelecting()) {
                // 框选模式，不执行普通移动
                shareData.tgfxBaseView?.markDirty();
                animationLoop(shareData);
                return;
            }
            
            // 普通拖动移动逻辑
            hasMoved = true;

            const screenDeltaX = clientXY.clientX - lastPointX;
            const screenDeltaY = clientXY.clientY - lastPointY;

            if (screenDeltaX !== 0 || screenDeltaY !== 0) {
                try {
                    shareData.tgfxBaseView?.moveHighlightLayer(screenDeltaX, screenDeltaY);
                } catch (error) {
                    console.error('移动图层时出错:', error);
                }

                lastPointX = clientXY.clientX;
                lastPointY = clientXY.clientY;

                shareData.tgfxBaseView?.markDirty();
                animationLoop(shareData);
            }

            return;
        }

        const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
        const reDraw = shareData.tgfxBaseView?.highlightLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
        if (reDraw) {
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }

        const cursorType = cursorDetectionCache.detectCursorType(clientXY.clientX, clientXY.clientY, shareData);
        setCursor(canvas, cursorType, shareData);
    }

    public onMouseLeave(_event: MouseEvent, _canvas: HTMLElement, _shareData: ShareData) {
        // 鼠标离开canvas时的处理
    }

    public onMouseDown(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        if (event.button === 0) { // 判断是否为左键
            const clientXY = ConvertCoordinates(event, canvas);
            const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

            // 检测当前光标类型
            const cursorType = cursorDetectionCache.detectCursorType(clientXY.clientX, clientXY.clientY, shareData);
            
            // 优先检测角控制器（缩放）- 只有当光标是缩放类型时才进入缩放模式
            if (cursorType === 'nw-resize' || cursorType === 'ne-resize' || 
                cursorType === 'sw-resize' || cursorType === 'se-resize') {
                
                const cornerInfo = cursorDetectionCache.detectCornerPosition(clientXY.clientX, clientXY.clientY, shareData);
                if (cornerInfo && cornerInfo.distance < 8) {
                    
                    // 获取检测到位置的索引（这就是用户看到的位置）
                    const cornerIndexMap: { [key: string]: number } = {
                        '左上角': 0, '右上角': 1, '右下角': 2, '左下角': 3
                    };
                    const detectedIdx = cornerIndexMap[cornerInfo.position] ?? -1;
                    
                    // 检测是否处于多选模式
                    const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                             (shareData.tgfxBaseView as any).isInMultiSelectionMode();
                    
                    if (isMultiSelection) {
                        // 多选模式的缩放逻辑
                        const oppositeCornerIdx = (detectedIdx + 2) % 4;
                        
                        const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
                        if (cornersVector && typeof cornersVector.size === 'function' && cornersVector.size() >= 8) {
                            const oppositeCenterX = cornersVector.get(oppositeCornerIdx * 2);
                            const oppositeCenterY = cornersVector.get(oppositeCornerIdx * 2 + 1);
                            
                            const oppositeScreenCoords = CoordinateTransformer.worldToScreen(
                                oppositeCenterX, oppositeCenterY, shareData
                            );
                            
                            shareData.tgfxBaseView?.resetHighlightLayer();
                            
                            // 开始缩放状态，传入屏幕坐标（多选模式使用）
                            scaleStateManager.startScaling(
                                worldCoords.worldX, worldCoords.worldY, 
                                oppositeCenterX, oppositeCenterY, 
                                detectedIdx, 
                                0, 0,  // 多选模式不使用本地坐标
                                true,  // isMultiSelection = true
                                oppositeScreenCoords.screenX, oppositeScreenCoords.screenY  // 传入对角点的屏幕坐标
                            );
                            
                            isMouseDown = true;
                            hasMoved = false;
                            lastPointX = clientXY.clientX;
                            lastPointY = clientXY.clientY;
                            return;
                        }
                    } else {
                        // ========== 单选模式的缩放逻辑 ==========
                        // cornerInfo.position 现在返回的是视觉位置名称
                        // cornerInfo.localCornerIndex 是本地坐标空间中的角索引
                        
                        const localCornerIdx = cornerInfo.localCornerIndex;
                        
                        // 对角的本地索引：在本地坐标空间中，对角就是 (index + 2) % 4
                        const oppositeLocalIdx = (localCornerIdx + 2) % 4;
                        
                        // 获取固定点（对角）的本地坐标
                        const localCornerVector = (shareData.tgfxBaseView as any).getSelectedLayerLocalCorner(oppositeLocalIdx);
                        
                        if (localCornerVector && typeof localCornerVector.size === 'function' && localCornerVector.size() >= 2) {
                            const localX = localCornerVector.get(0);
                            const localY = localCornerVector.get(1);
                            
                            // 将本地坐标转换为世界坐标（初始位置）
                            const worldCornerVector = (shareData.tgfxBaseView as any).localToWorldCoords(localX, localY);
                            if (worldCornerVector && typeof worldCornerVector.size === 'function' && worldCornerVector.size() >= 2) {
                                const oppositeCenterX = worldCornerVector.get(0);
                                const oppositeCenterY = worldCornerVector.get(1);
                                
                                shareData.tgfxBaseView?.resetHighlightLayer();
                                
                                // 传入视觉索引 detectedIdx，用于翻转判断
                                scaleStateManager.startScaling(worldCoords.worldX, worldCoords.worldY, oppositeCenterX, oppositeCenterY, detectedIdx, localX, localY, false, undefined, undefined, shareData);
                                
                                isMouseDown = true;
                                hasMoved = false;
                                lastPointX = clientXY.clientX;
                                lastPointY = clientXY.clientY;
                                return;
                            }
                        }
                    }
                }
            }
            
            // 检测旋转操作
            if (cursorType === 'rotate') {
                const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                         (shareData.tgfxBaseView as any).isInMultiSelectionMode();
                
                if (isMultiSelection) {
                    const centerVector = (shareData.tgfxBaseView as any).getSelectedLayerCenter();
                    if (centerVector && typeof centerVector.size === 'function' && centerVector.size() >= 2) {
                        const centerX = centerVector.get(0);
                        const centerY = centerVector.get(1);
                        
                        shareData.tgfxBaseView?.resetHighlightLayer();
                        
                        rotationStateManager.startRotation(worldCoords.worldX, worldCoords.worldY, centerX, centerY, '__MULTI_SELECTION__');
                        rotationStateManager.setFallbackCenter(centerX, centerY);
                        
                        isMouseDown = true;
                        hasMoved = false;
                        lastPointX = clientXY.clientX;
                        lastPointY = clientXY.clientY;
                        return;
                    } else {
                        console.error('[旋转-多选] 无法获取AABB中心点，取消旋转操作');
                        return;
                    }
                } else {
                    const layerInfo = (shareData.tgfxBaseView as any).getSelectedLayerInfo();
                    let layerId = '';
                    if (layerInfo && layerInfo.size && layerInfo.size() >= 3) {
                        layerId = layerInfo.get(2);
                    }
                    
                    const centerVector = (shareData.tgfxBaseView as any).getSelectedLayerCenter();
                    if (centerVector && typeof centerVector.size === 'function' && centerVector.size() >= 2) {
                        const centerX = centerVector.get(0);
                        const centerY = centerVector.get(1);
                        
                        shareData.tgfxBaseView?.resetHighlightLayer();
                        
                        rotationStateManager.startRotation(worldCoords.worldX, worldCoords.worldY, centerX, centerY, layerId);
                        rotationStateManager.setFallbackCenter(centerX, centerY);
                        
                        isMouseDown = true;
                        hasMoved = false;
                        lastPointX = clientXY.clientX;
                        lastPointY = clientXY.clientY;
                        return;
                    } else {
                        console.error('[旋转-单选] 无法获取图层中心点，取消旋转操作');
                        return;
                    }
                }
            }

            // 默认的选择和移动逻辑
            shareData.tgfxBaseView?.resetHighlightLayer();
            
            const hasSelectedLayer = shareData.tgfxBaseView?.selectMoveLayer(worldCoords.worldX, worldCoords.worldY);
            
            if (hasSelectedLayer) {
                // 选中了图层，正常处理，不启动框选
                lastPointX = clientXY.clientX;
                lastPointY = clientXY.clientY;
                isMouseDown = true;
                hasMoved = false;
            } else {
                // 未选中图层，点击空白区域，准备框选
                boxSelectionManager.onMouseDown(
                    clientXY.clientX, clientXY.clientY,
                    worldCoords.worldX, worldCoords.worldY
                );
                lastPointX = clientXY.clientX;
                lastPointY = clientXY.clientY;
                isMouseDown = true;
                hasMoved = false;
            }
            
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }
    }

    public onMouseUp(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        if (event.button === 0) { // 判断是否为左键
            // 如果正在缩放，结束缩放状态
            if (scaleStateManager.isInScaling()) {
                scaleStateManager.endScaling();
                // 重置状态
                isMouseDown = false;
                hasMoved = false;
                shareData.tgfxBaseView?.markDirty();
                animationLoop(shareData);
                return;
            }
            
            // 如果正在旋转，结束旋转状态
            if (rotationStateManager.isInRotation()) {
                rotationStateManager.endRotation();
                // 重置状态
                isMouseDown = false;
                hasMoved = false;
                shareData.tgfxBaseView?.markDirty();
                animationLoop(shareData);
                return;
            }
            
            // 处理框选结束
            if (boxSelectionManager.isBoxSelecting()) {
                boxSelectionManager.onMouseUp(shareData);
                shareData.tgfxBaseView?.markDirty();
                animationLoop(shareData);
                isMouseDown = false;
                hasMoved = false;
                return;
            }
            
            // 重置框选管理器状态，避免isPrepared状态残留导致下次点击误触发框选
            boxSelectionManager.reset();

            if (!hasMoved) {
                // 单击事件：调用选中方法
                const clientXY = ConvertCoordinates(event, canvas);
                const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
                shareData.tgfxBaseView?.selectLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
            } else {
                shareData.tgfxBaseView?.resetMoveLayers();
                // 清除本地空间缓存（关键：移动改变了图层位置）
                localSpaceInteraction.clearCache();
            }

            // 重置状态
            isMouseDown = false;
            hasMoved = false;

            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }
    }

    public onClick(_event: MouseEvent, _canvas: HTMLElement, shareData: ShareData) {
        shareData.tgfxBaseView?.resetHighlightLayer();
        shareData.tgfxBaseView?.markDirty();
        animationLoop(shareData);
    }
}

// 导出GestureManager实例
export const gestureManager = new GestureManager();

// 初始化鼠标事件监听
export function initMouseEvents(canvas: HTMLElement, shareData: ShareData) {
    canvas.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault();
        gestureManager.onWheel(event, canvas, shareData);
    });

    canvas.addEventListener('mousemove', (event: MouseEvent) => {
        gestureManager.onMouseMove(event, canvas, shareData);
    });

    canvas.addEventListener('mouseleave', (event: MouseEvent) => {
        gestureManager.onMouseLeave(event, canvas, shareData);
    });

    canvas.addEventListener('mousedown', (event: MouseEvent) => {
        gestureManager.onMouseDown(event, canvas, shareData);
    });

    canvas.addEventListener('mouseup', (event: MouseEvent) => {
        gestureManager.onMouseUp(event, canvas, shareData);
    });

    canvas.addEventListener('click', (event: MouseEvent) => {
        gestureManager.onClick(event, canvas, shareData);
    });
}