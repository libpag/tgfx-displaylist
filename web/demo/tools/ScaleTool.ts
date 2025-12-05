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

import { ShareData } from '../common';
import { ITool, MouseEventData } from './ITool';
import { InteractionConfig, CornerDetector } from './shared';

/**
 * 缩放工具
 * 
 * 负责：
 * - 检测角控制器
 * - 处理缩放交互
 * - 支持翻转检测（使用点积投影方法）
 * 
 * 核心策略：
 * - 使用相邻帧之间的距离比例计算缩放因子
 * - 通过投影符号变化检测翻转
 * - 翻转时只发送 -1 的缩放因子，不改变大小
 */
export class ScaleTool implements ITool {
    readonly name = 'ScaleTool';
    
    private isScaling = false;
    
    // 缩放状态
    private cornerIndex = -1;                    // 视觉角索引 (0=左上, 1=右上, 2=右下, 3=左下)
    private anchorWorldCoord: { x: number; y: number } | null = null;  // 锚点（对角）的世界坐标
    private anchorLocalCoord: { x: number; y: number } | null = null;  // 锚点的本地坐标（单选模式）
    private isMultiSelectionMode = false;
    
    // 单选模式：局部坐标轴（mouseDown时固定，用于投影计算）
    private localAxisX: { x: number; y: number } = { x: 1, y: 0 };
    private localAxisY: { x: number; y: number } = { x: 0, y: 1 };
    
    // 上一帧的投影/距离值（用于计算帧间缩放比例）
    private lastProjection = 0;
    
    // 上一帧投影值的符号（用于检测翻转）
    private lastSignX = 0;
    private lastSignY = 0;

    onMouseDown(event: MouseEventData, _canvas: HTMLElement, shareData: ShareData): boolean {
        if (event.button !== 0) return false;

        // 检测是否点击了角控制器
        const cornerResult = CornerDetector.detectCorner(event.screenX, event.screenY, shareData);
        if (!cornerResult || cornerResult.screenPixelDistance >= InteractionConfig.CORNER_HIT_TOLERANCE_PIXELS) {
            return false;
        }

        // 开始缩放
        this.isScaling = true;
        
        // 确定视觉角索引
        const cornerIndexMap: { [key: string]: number } = {
            '左上角': 0, '右上角': 1, '右下角': 2, '左下角': 3
        };
        this.cornerIndex = cornerIndexMap[cornerResult.position] ?? -1;
        
        // 检测多选模式
        this.isMultiSelectionMode = (shareData.tgfxBaseView as any)?.isInMultiSelectionMode?.() ?? false;
        
        // 获取对角点坐标
        const oppositeCornerIdx = (this.cornerIndex + 2) % 4;
        
        if (this.isMultiSelectionMode) {
            // 多选模式：缓存对角点的屏幕坐标
            this.initMultiSelectionMode(oppositeCornerIdx, event, shareData);
        } else {
            // 单选模式：使用去旋转化策略
            this.initSingleSelectionMode(oppositeCornerIdx, cornerResult.localCornerIndex, event, shareData);
        }

        // 重置高亮
        shareData.tgfxBaseView?.resetHighlightLayer();
        
        console.log(`[ScaleTool] 开始缩放, 角: ${cornerResult.position}, 多选: ${this.isMultiSelectionMode}`);
        return true;
    }

    /**
     * 初始化多选模式
     * 
     * 多选模式使用简单的"帧间距离比"方法计算缩放
     */
    private initMultiSelectionMode(
        oppositeCornerIdx: number, 
        event: MouseEventData, 
        shareData: ShareData
    ): void {
        const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
        if (cornersVector && cornersVector.size() >= 8) {
            const oppX = cornersVector.get(oppositeCornerIdx * 2);
            const oppY = cornersVector.get(oppositeCornerIdx * 2 + 1);
            
            this.anchorWorldCoord = { x: oppX, y: oppY };
            this.anchorLocalCoord = null;
            
            // 计算初始距离（鼠标到锚点的距离）
            const dx = event.worldX - oppX;
            const dy = event.worldY - oppY;
            this.lastProjection = Math.hypot(dx, dy);
            
            // 初始化符号（用于翻转检测）
            const isRightCorner = (this.cornerIndex === 1 || this.cornerIndex === 2);
            const isBottomCorner = (this.cornerIndex === 2 || this.cornerIndex === 3);
            this.lastSignX = isRightCorner ? 1 : -1;
            this.lastSignY = isBottomCorner ? 1 : -1;
            
            console.log(`[ScaleTool] 多选模式初始化, 锚点: (${oppX.toFixed(1)}, ${oppY.toFixed(1)})`);
        }
    }

    /**
     * 初始化单选模式（使用去旋转化策略）
     * 
     * 核心：直接从图层的世界坐标角点计算局部坐标轴，自动处理任何旋转和翻转状态
     */
    private initSingleSelectionMode(
        _oppositeCornerIdx: number,
        localCornerIdx: number,
        event: MouseEventData, 
        shareData: ShareData
    ): void {
        // 获取对角点的本地坐标
        const oppositeLocalIdx = (localCornerIdx + 2) % 4;
        const localCornerVector = (shareData.tgfxBaseView as any).getSelectedLayerLocalCorner(oppositeLocalIdx);
        
        if (localCornerVector && localCornerVector.size() >= 2) {
            const localX = localCornerVector.get(0);
            const localY = localCornerVector.get(1);
            this.anchorLocalCoord = { x: localX, y: localY };
            
            // 将本地坐标转换为世界坐标
            const worldCornerVector = (shareData.tgfxBaseView as any).localToWorldCoords(localX, localY);
            if (worldCornerVector && worldCornerVector.size() >= 2) {
                this.anchorWorldCoord = {
                    x: worldCornerVector.get(0),
                    y: worldCornerVector.get(1)
                };
            }
        }
        
        // 从图层的世界坐标角点计算局部坐标轴
        // 这种方法自动处理任何旋转和翻转状态
        const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
        if (cornersVector && cornersVector.size() >= 8) {
            // 提取4个角的世界坐标 (0=左上, 1=右上, 2=右下, 3=左下)
            const corners: { x: number; y: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1)
                });
            }
            
            // 计算边向量（从锚点角到相邻角）
            // 锚点是 oppositeCornerIdx，我们需要找到它的两个相邻角
            const anchorIdx = (this.cornerIndex + 2) % 4;  // 锚点角索引
            const nextIdx = (anchorIdx + 1) % 4;
            const prevIdx = (anchorIdx + 3) % 4;
            
            // 从锚点到相邻角的向量
            const edgeX = { x: corners[nextIdx].x - corners[anchorIdx].x, y: corners[nextIdx].y - corners[anchorIdx].y };
            const edgeY = { x: corners[prevIdx].x - corners[anchorIdx].x, y: corners[prevIdx].y - corners[anchorIdx].y };
            
            // 归一化
            const lenX = Math.hypot(edgeX.x, edgeX.y);
            const lenY = Math.hypot(edgeY.x, edgeY.y);
            
            if (lenX > 1e-6 && lenY > 1e-6) {
                this.localAxisX = { x: edgeX.x / lenX, y: edgeX.y / lenX };
                this.localAxisY = { x: edgeY.x / lenY, y: edgeY.y / lenY };
            }
        }
        
        // 计算初始投影值
        if (this.anchorWorldCoord) {
            const dx = event.worldX - this.anchorWorldCoord.x;
            const dy = event.worldY - this.anchorWorldCoord.y;
            
            // 投影到局部坐标轴
            const projX = dx * this.localAxisX.x + dy * this.localAxisX.y;
            const projY = dx * this.localAxisY.x + dy * this.localAxisY.y;
            this.lastProjection = Math.hypot(projX, projY);
            
            // 记录初始符号
            this.lastSignX = Math.sign(projX);
            this.lastSignY = Math.sign(projY);
        }
        
        console.log(`[ScaleTool] 单选模式初始化, 局部轴: X(${this.localAxisX.x.toFixed(2)}, ${this.localAxisX.y.toFixed(2)}), Y(${this.localAxisY.x.toFixed(2)}, ${this.localAxisY.y.toFixed(2)})`);
    }

    onMouseMove(event: MouseEventData, _canvas: HTMLElement, shareData: ShareData): boolean {
        if (!this.isScaling) return false;

        try {
            if (this.isMultiSelectionMode) {
                this.handleMultiSelectionScale(event, shareData);
            } else {
                this.handleSingleSelectionScale(event, shareData);
            }
        } catch (error) {
            console.error('[ScaleTool] 缩放失败:', error);
        }

        return true;
    }

    /**
     * 处理多选模式缩放
     * 
     * 使用简单的"帧间距离比"方法：scale = 当前距离 / 上一帧距离
     * 
     * 重要：锚点使用固定的世界坐标（mouseDown时确定），不要每帧重新计算！
     * 因为缩放会改变 AABB，如果从屏幕坐标转换会导致锚点漂移。
     */
    private handleMultiSelectionScale(event: MouseEventData, shareData: ShareData): void {
        // 使用固定的世界坐标作为锚点
        if (!this.anchorWorldCoord) {
            console.log('[ScaleTool] 多选缩放: anchorWorldCoord 为空');
            return;
        }

        // 计算当前鼠标到锚点的距离（使用固定的世界坐标锚点）
        const dx = event.worldX - this.anchorWorldCoord.x;
        const dy = event.worldY - this.anchorWorldCoord.y;
        const currentDistance = Math.hypot(dx, dy);

        // 检测翻转（基于位置关系）
        const isRightCorner = (this.cornerIndex === 1 || this.cornerIndex === 2);
        const isBottomCorner = (this.cornerIndex === 2 || this.cornerIndex === 3);
        
        // 判断鼠标是否越过锚点
        const shouldFlipX = isRightCorner ? (dx < 0) : (dx > 0);
        const shouldFlipY = isBottomCorner ? (dy < 0) : (dy > 0);
        
        const needFlipX = (this.lastSignX > 0) !== !shouldFlipX;
        const needFlipY = (this.lastSignY > 0) !== !shouldFlipY;

        let scaleX = 1.0;
        let scaleY = 1.0;

        if (needFlipX || needFlipY) {
            // 发生翻转
            if (needFlipX) {
                scaleX = -1.0;
                this.lastSignX = shouldFlipX ? -1 : 1;
            }
            if (needFlipY) {
                scaleY = -1.0;
                this.lastSignY = shouldFlipY ? -1 : 1;
            }
            this.lastProjection = Math.max(currentDistance, 1e-6);
        } else {
            // 正常缩放：帧间距离比
            if (this.lastProjection > 1e-6) {
                const scaleFactor = currentDistance / this.lastProjection;
                scaleX = scaleFactor;
                scaleY = scaleFactor;
            }
            this.lastProjection = currentDistance;
        }

        if (Math.abs(scaleX - 1.0) > InteractionConfig.SCALE_CHANGE_THRESHOLD ||
            Math.abs(scaleY - 1.0) > InteractionConfig.SCALE_CHANGE_THRESHOLD) {
            (shareData.tgfxBaseView as any).scaleMultiSelection(
                scaleX, scaleY, this.anchorWorldCoord.x, this.anchorWorldCoord.y
            );
        }
    }

    /**
     * 处理单选模式缩放
     * 
     * 核心策略：角控制器跟随鼠标
     * - 使用"鼠标投影 / 当前图层边长"计算缩放因子
     * - 缩放后图层角点正好在鼠标位置，角控制器自然跟随鼠标
     * 
     * 重要：不要每帧重新计算轴方向！轴方向在 onMouseDown 时固定，
     * 翻转通过缩放因子的符号来实现，而不是改变轴方向。
     */
    private handleSingleSelectionScale(event: MouseEventData, shareData: ShareData): void {
        if (!this.anchorLocalCoord || !this.anchorWorldCoord) return;

        // 将本地坐标转换为当前世界坐标
        const worldCornerVector = (shareData.tgfxBaseView as any).localToWorldCoords(
            this.anchorLocalCoord.x, 
            this.anchorLocalCoord.y
        );
        
        if (!worldCornerVector || worldCornerVector.size() < 2) return;

        const anchorWorldX = worldCornerVector.get(0);
        const anchorWorldY = worldCornerVector.get(1);

        // 获取当前图层的边长（从角点计算）
        const currentEdgeLengths = this.getCurrentEdgeLengths(shareData);
        if (!currentEdgeLengths) return;

        // 【关键】不要每帧重新计算轴方向！使用初始化时固定的轴方向
        // 这样翻转后投影符号会变化，我们通过缩放因子的符号来实现翻转

        // 计算当前鼠标相对于锚点的向量
        const dx = event.worldX - anchorWorldX;
        const dy = event.worldY - anchorWorldY;

        // 投影到局部坐标轴（点积）- 使用固定的轴方向
        const projX = dx * this.localAxisX.x + dy * this.localAxisX.y;
        const projY = dx * this.localAxisY.x + dy * this.localAxisY.y;

        // 计算缩放因子：鼠标投影 / 当前边长
        const { scaleX, scaleY } = this.calculateScaleForMouseFollow(
            projX, projY, currentEdgeLengths.edgeX, currentEdgeLengths.edgeY
        );

        if (Math.abs(scaleX - 1.0) > InteractionConfig.SCALE_CHANGE_THRESHOLD ||
            Math.abs(scaleY - 1.0) > InteractionConfig.SCALE_CHANGE_THRESHOLD) {
            (shareData.tgfxBaseView as any).scaleSelectedLayerWithLocalPivot(
                scaleX, scaleY, 
                this.anchorLocalCoord.x, 
                this.anchorLocalCoord.y
            );
        }
    }

    /**
     * 获取当前图层的边长（世界坐标）
     */
    private getCurrentEdgeLengths(shareData: ShareData): { edgeX: number; edgeY: number } | null {
        const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
        if (!cornersVector || cornersVector.size() < 8) return null;

        // 提取4个角的世界坐标
        const corners: { x: number; y: number }[] = [];
        for (let i = 0; i < 4; i++) {
            corners.push({
                x: cornersVector.get(i * 2),
                y: cornersVector.get(i * 2 + 1)
            });
        }
        
        // 计算从锚点到相邻角的边长
        const anchorIdx = (this.cornerIndex + 2) % 4;
        const nextIdx = (anchorIdx + 1) % 4;
        const prevIdx = (anchorIdx + 3) % 4;
        
        const edgeX = Math.hypot(
            corners[nextIdx].x - corners[anchorIdx].x,
            corners[nextIdx].y - corners[anchorIdx].y
        );
        const edgeY = Math.hypot(
            corners[prevIdx].x - corners[anchorIdx].x,
            corners[prevIdx].y - corners[anchorIdx].y
        );

        return { edgeX, edgeY };
    }

    /**
     * 计算使角控制器跟随鼠标的缩放因子
     * 
     * 核心：缩放因子 = 鼠标投影 / 当前边长
     * 
     * 由于使用固定的轴方向（onMouseDown时确定），投影值的符号直接反映了
     * 鼠标相对于锚点的位置。当投影为负时，说明鼠标越过了锚点，需要翻转。
     * 
     * 翻转策略：
     * - 投影符号变化时，发送 -1 的缩放因子来翻转图层
     * - 翻转后更新 lastSign，后续帧继续正常缩放
     */
    private calculateScaleForMouseFollow(
        projX: number, projY: number, 
        currentEdgeX: number, currentEdgeY: number
    ): { scaleX: number; scaleY: number } {
        // 死区阈值：防止除以过小的值
        const MIN_EDGE = 5.0;  // 最小边长5像素
        
        const safeEdgeX = Math.max(currentEdgeX, MIN_EDGE);
        const safeEdgeY = Math.max(currentEdgeY, MIN_EDGE);

        // 当前投影的符号（投影值足够大时才更新符号）
        const currentSignX = Math.abs(projX) > MIN_EDGE ? Math.sign(projX) : this.lastSignX;
        const currentSignY = Math.abs(projY) > MIN_EDGE ? Math.sign(projY) : this.lastSignY;
        
        // 检测翻转：符号从非零变为相反的非零
        const flipX = (this.lastSignX !== 0 && currentSignX !== 0 && this.lastSignX !== currentSignX);
        const flipY = (this.lastSignY !== 0 && currentSignY !== 0 && this.lastSignY !== currentSignY);

        let scaleX = 1.0;
        let scaleY = 1.0;

        if (flipX || flipY) {
            // 发生翻转：只发送 -1 的缩放因子，不改变大小
            if (flipX) {
                scaleX = -1.0;
                this.lastSignX = currentSignX;
            }
            if (flipY) {
                scaleY = -1.0;
                this.lastSignY = currentSignY;
            }
        } else {
            // 正常缩放：缩放因子 = |鼠标投影| / 当前边长
            // 使用绝对值，因为符号已经通过翻转处理了
            const targetEdgeX = Math.max(Math.abs(projX), MIN_EDGE);
            const targetEdgeY = Math.max(Math.abs(projY), MIN_EDGE);
            
            scaleX = targetEdgeX / safeEdgeX;
            scaleY = targetEdgeY / safeEdgeY;
            
            // 等比例缩放：取平均值
            const avgScale = (scaleX + scaleY) / 2;
            scaleX = avgScale;
            scaleY = avgScale;
        }

        return { scaleX, scaleY };
    }

    onMouseUp(_event: MouseEventData, _canvas: HTMLElement, _shareData: ShareData): boolean {
        if (!this.isScaling) return false;
        
        this.reset();
        console.log('[ScaleTool] 缩放结束');
        return true;
    }

    getCursor(event: MouseEventData, shareData: ShareData): string | null {
        const cornerResult = CornerDetector.detectCorner(event.screenX, event.screenY, shareData);
        if (!cornerResult) return null;

        // 只有在缩放区域内才返回缩放光标
        if (cornerResult.screenPixelDistance < InteractionConfig.CORNER_HIT_TOLERANCE_PIXELS) {
            switch (cornerResult.position) {
                case '左上角': return 'nw-resize';
                case '右上角': return 'ne-resize';
                case '左下角': return 'sw-resize';
                case '右下角': return 'se-resize';
            }
        }

        return null;
    }

    isActive(): boolean {
        return this.isScaling;
    }

    reset(): void {
        this.isScaling = false;
        this.cornerIndex = -1;
        this.anchorWorldCoord = null;
        this.anchorLocalCoord = null;
        this.isMultiSelectionMode = false;
        this.lastProjection = 0;
        this.lastSignX = 0;
        this.lastSignY = 0;
    }
}
