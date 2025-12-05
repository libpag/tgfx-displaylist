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
import { InteractionConfig, CornerDetector, PolygonUtils } from './shared';

/**
 * 旋转工具
 * 
 * 负责：
 * - 检测旋转区域（角控制器外围 30-80px）
 * - 处理旋转交互
 * - 支持翻转状态下的旋转方向修正
 */
export class RotateTool implements ITool {
    readonly name = 'RotateTool';
    
    private isRotating = false;
    
    // 旋转状态
    private cachedCenter: { x: number; y: number } | null = null;
    private lastPoint: { x: number; y: number } = { x: 0, y: 0 };
    private cachedRadius = 0;
    private totalRotation = 0;
    private lastLayerId = '';
    private isMultiSelectionMode = false;
    
    // 翻转状态（用于修正旋转方向）
    private isFlippedX = false;
    private isFlippedY = false;

    onMouseDown(event: MouseEventData, _canvas: HTMLElement, shareData: ShareData): boolean {
        if (event.button !== 0) return false;

        // 检测是否在旋转区域
        const cornerResult = CornerDetector.detectCorner(event.screenX, event.screenY, shareData);
        if (!cornerResult) return false;

        // 旋转区域：30-80px
        const distance = cornerResult.screenPixelDistance;
        if (distance < InteractionConfig.CORNER_HIT_TOLERANCE_PIXELS ||
            distance >= InteractionConfig.ROTATION_ZONE_TOLERANCE_PIXELS) {
            return false;
        }

        // 检查是否在图层内部（如果在内部，不启动旋转）
        const isMultiSelection = (shareData.tgfxBaseView as any)?.isInMultiSelectionMode?.() ?? false;
        let isInsideLayer = false;
        
        if (isMultiSelection) {
            isInsideLayer = PolygonUtils.isPointInMultiSelectionBounds(event.worldX, event.worldY, shareData);
        } else {
            isInsideLayer = PolygonUtils.isPointInSelectedLayer(event.worldX, event.worldY, shareData);
        }

        if (isInsideLayer) {
            return false;
        }

        // 开始旋转
        this.isRotating = true;
        this.isMultiSelectionMode = isMultiSelection;

        // 获取旋转中心
        const centerVector = (shareData.tgfxBaseView as any).getSelectedLayerCenter();
        if (centerVector && centerVector.size() >= 2) {
            this.cachedCenter = {
                x: centerVector.get(0),
                y: centerVector.get(1)
            };
        } else {
            console.error('[RotateTool] 无法获取旋转中心');
            this.isRotating = false;
            return false;
        }

        this.lastPoint = { x: event.worldX, y: event.worldY };
        this.cachedRadius = Math.hypot(
            event.worldX - this.cachedCenter.x,
            event.worldY - this.cachedCenter.y
        );

        // 获取图层ID（用于检测是否切换了图层）
        if (isMultiSelection) {
            const newLayerId = '__MULTI_SELECTION__';
            if (newLayerId !== this.lastLayerId) {
                this.totalRotation = 0;
                this.lastLayerId = newLayerId;
                this.isFlippedX = false;
                this.isFlippedY = false;
            }
        } else {
            const layerInfo = (shareData.tgfxBaseView as any).getSelectedLayerInfo();
            if (layerInfo && layerInfo.size() >= 3) {
                const newLayerId = layerInfo.get(2);
                if (newLayerId !== this.lastLayerId) {
                    this.totalRotation = 0;
                    this.lastLayerId = newLayerId;
                }
            }
            
            // 获取翻转状态
            const flipState = (shareData.tgfxBaseView as any).getSelectedLayerFlipState();
            if (flipState && flipState.size() >= 2) {
                this.isFlippedX = flipState.get(0) > 0.5;
                this.isFlippedY = flipState.get(1) > 0.5;
            }
        }

        shareData.tgfxBaseView?.resetHighlightLayer();
        
        console.log(`[RotateTool] 开始旋转, 多选: ${this.isMultiSelectionMode}`);
        return true;
    }

    onMouseMove(event: MouseEventData, _canvas: HTMLElement, shareData: ShareData): boolean {
        if (!this.isRotating || !this.cachedCenter) return false;

        try {
            // 检查半径是否足够
            const currentRadius = Math.hypot(
                event.worldX - this.cachedCenter.x,
                event.worldY - this.cachedCenter.y
            );
            
            const minRadius = Math.max(
                this.cachedRadius * InteractionConfig.MIN_ROTATION_RADIUS_FACTOR,
                InteractionConfig.MIN_ABSOLUTE_RADIUS
            );
            
            if (currentRadius < minRadius) {
                console.warn('[RotateTool] 半径过小，忽略旋转');
                return true;
            }

            // 计算增量旋转角度
            const deltaAngle = this.calculateDeltaAngle(event.worldX, event.worldY);
            
            if (Math.abs(deltaAngle) > 0) {
                if (this.isMultiSelectionMode) {
                    (shareData.tgfxBaseView as any).rotateMultiSelection(deltaAngle);
                } else {
                    (shareData.tgfxBaseView as any).rotateSelectedLayer(deltaAngle, Number.NaN, Number.NaN);
                }
                
                this.totalRotation += deltaAngle;
            }

            this.lastPoint = { x: event.worldX, y: event.worldY };
        } catch (error) {
            console.error('[RotateTool] 旋转失败:', error);
        }

        return true;
    }

    /**
     * 计算增量旋转角度
     */
    private calculateDeltaAngle(currentX: number, currentY: number): number {
        if (!this.cachedCenter) return 0;

        const centerX = this.cachedCenter.x;
        const centerY = this.cachedCenter.y;

        // 计算上一帧和当前帧的向量
        const lastVector = {
            x: this.lastPoint.x - centerX,
            y: this.lastPoint.y - centerY
        };
        const currentVector = {
            x: currentX - centerX,
            y: currentY - centerY
        };

        // 检查半径
        const lastRadius = Math.hypot(lastVector.x, lastVector.y);
        const currentRadius = Math.hypot(currentVector.x, currentVector.y);
        const minRadius = Math.max(
            this.cachedRadius * InteractionConfig.MIN_ROTATION_RADIUS_FACTOR,
            InteractionConfig.MIN_ABSOLUTE_RADIUS
        );

        if (lastRadius < minRadius || currentRadius < minRadius) {
            return 0;
        }

        // 计算角度差
        const lastAngle = Math.atan2(lastVector.y, lastVector.x);
        const currentAngle = Math.atan2(currentVector.y, currentVector.x);
        
        let deltaAngle = currentAngle - lastAngle;

        // 处理角度跨越 ±π 的情况
        if (deltaAngle > Math.PI) {
            deltaAngle -= 2 * Math.PI;
        } else if (deltaAngle < -Math.PI) {
            deltaAngle += 2 * Math.PI;
        }

        // 翻转修正：只有当有奇数个轴翻转时，才需要反转旋转方向
        if ((this.isFlippedX && !this.isFlippedY) || (this.isFlippedY && !this.isFlippedX)) {
            deltaAngle = -deltaAngle;
        }

        return deltaAngle;
    }

    onMouseUp(_event: MouseEventData, _canvas: HTMLElement, _shareData: ShareData): boolean {
        if (!this.isRotating) return false;
        
        this.isRotating = false;
        this.cachedCenter = null;
        this.cachedRadius = 0;
        
        console.log(`[RotateTool] 旋转结束, 总角度: ${(this.totalRotation * 180 / Math.PI).toFixed(1)}°`);
        return true;
    }

    getCursor(event: MouseEventData, shareData: ShareData): string | null {
        const cornerResult = CornerDetector.detectCorner(event.screenX, event.screenY, shareData);
        if (!cornerResult) return null;

        const distance = cornerResult.screenPixelDistance;
        
        // 旋转区域：30-80px
        if (distance >= InteractionConfig.CORNER_HIT_TOLERANCE_PIXELS &&
            distance < InteractionConfig.ROTATION_ZONE_TOLERANCE_PIXELS) {
            
            // 检查是否在图层内部
            const isMultiSelection = (shareData.tgfxBaseView as any)?.isInMultiSelectionMode?.() ?? false;
            let isInsideLayer = false;
            
            if (isMultiSelection) {
                isInsideLayer = PolygonUtils.isPointInMultiSelectionBounds(event.worldX, event.worldY, shareData);
            } else {
                isInsideLayer = PolygonUtils.isPointInSelectedLayer(event.worldX, event.worldY, shareData);
            }

            // 如果在图层内部，不显示旋转光标
            if (!isInsideLayer) {
                return 'rotate';
            }
        }

        return null;
    }

    isActive(): boolean {
        return this.isRotating;
    }

    reset(): void {
        this.isRotating = false;
        this.cachedCenter = null;
        this.cachedRadius = 0;
        this.isMultiSelectionMode = false;
    }
}
