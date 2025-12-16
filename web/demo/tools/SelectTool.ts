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
import { InteractionConfig, PolygonUtils } from './shared';

/**
 * 选择工具状态
 */
enum SelectToolState {
    IDLE,           // 空闲
    MOVING,         // 移动图层
    BOX_SELECTING,  // 框选中
    PREPARED,       // 准备框选（点击空白区域但未开始拖动）
}

/**
 * 选择工具
 * 
 * 负责：
 * - 点选图层
 * - 框选多个图层
 * - 移动选中的图层
 */
export class SelectTool implements ITool {
    readonly name = 'SelectTool';
    
    private state: SelectToolState = SelectToolState.IDLE;
    
    // 移动相关
    private lastScreenX = 0;
    private lastScreenY = 0;
    private hasMoved = false;
    
    // 框选相关
    private boxSelectStartScreenX = 0;
    private boxSelectStartScreenY = 0;
    private boxSelectStartWorldX = 0;
    private boxSelectStartWorldY = 0;

    onMouseDown(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): boolean {
        if (event.button !== 0) return false;

        // 重置高亮
        shareData.tgfxBaseView?.resetHighlightLayer();
        
        // 尝试选中图层
        const hasSelectedLayer = shareData.tgfxBaseView?.selectMoveLayer(event.worldX, event.worldY);
        
        if (hasSelectedLayer) {
            // 选中了图层，进入移动模式
            this.state = SelectToolState.MOVING;
            this.lastScreenX = event.screenX;
            this.lastScreenY = event.screenY;
            this.hasMoved = false;
            return true;
        } else {
            // 点击空白区域，准备框选
            this.state = SelectToolState.PREPARED;
            this.boxSelectStartScreenX = event.screenX;
            this.boxSelectStartScreenY = event.screenY;
            this.boxSelectStartWorldX = event.worldX;
            this.boxSelectStartWorldY = event.worldY;
            this.lastScreenX = event.screenX;
            this.lastScreenY = event.screenY;
            this.hasMoved = false;
            return true;
        }
    }

    onMouseMove(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): boolean {
        if (this.state === SelectToolState.IDLE) {
            return false;
        }

        if (this.state === SelectToolState.MOVING) {
            // 移动图层
            const screenDeltaX = event.screenX - this.lastScreenX;
            const screenDeltaY = event.screenY - this.lastScreenY;

            if (screenDeltaX !== 0 || screenDeltaY !== 0) {
                this.hasMoved = true;
                
                try {
                    shareData.tgfxBaseView?.moveHighlightLayer(screenDeltaX, screenDeltaY);
                } catch (error) {
                    console.error('[SelectTool] 移动图层失败:', error);
                }

                this.lastScreenX = event.screenX;
                this.lastScreenY = event.screenY;
            }
            return true;
        }

        if (this.state === SelectToolState.PREPARED) {
            // 检查是否应该启动框选
            // 只有拖动距离达到阈值才启动框选，避免点击空白时误触发
            const dx = event.screenX - this.boxSelectStartScreenX;
            const dy = event.screenY - this.boxSelectStartScreenY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > InteractionConfig.BOX_SELECTION_MIN_DRAG) {
                // 启动框选
                this.state = SelectToolState.BOX_SELECTING;
                (shareData.tgfxBaseView as any).resetSelectedLayer();
                (shareData.tgfxBaseView as any).startBoxSelection(
                    this.boxSelectStartWorldX, 
                    this.boxSelectStartWorldY
                );
            }
            return true;
        }

        if (this.state === SelectToolState.BOX_SELECTING) {
            // 更新框选
            (shareData.tgfxBaseView as any).updateBoxSelection(event.worldX, event.worldY);
            return true;
        }

        return false;
    }

    onMouseUp(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): boolean {
        if (this.state === SelectToolState.IDLE) {
            return false;
        }

        if (this.state === SelectToolState.BOX_SELECTING) {
            // 结束框选，传入当前 zoom 值确保线宽计算正确
            (shareData.tgfxBaseView as any).endBoxSelectionWithZoom(
                shareData.zoom
            );
        } else if (this.state === SelectToolState.MOVING) {
            if (!this.hasMoved) {
                // 单击事件：重新选中
                shareData.tgfxBaseView?.selectLayerAndCheckRedraw(event.worldX, event.worldY);
            } else {
                // 移动结束
                shareData.tgfxBaseView?.resetMoveLayers();
            }
        } else if (this.state === SelectToolState.PREPARED) {
            // 准备状态下抬起，视为单击空白区域，清除选中状态
            (shareData.tgfxBaseView as any).resetSelectedLayer();
        }

        this.reset();
        return true;
    }

    getCursor(event: MouseEventData, shareData: ShareData): string | null {
        // 检查是否在选中图层内部
        const isMultiSelection = (shareData.tgfxBaseView as any)?.isInMultiSelectionMode?.() ?? false;
        
        let isInsideSelection = false;
        if (isMultiSelection) {
            isInsideSelection = PolygonUtils.isPointInMultiSelectionBounds(
                event.worldX, event.worldY, shareData
            );
        } else {
            isInsideSelection = PolygonUtils.isPointInSelectedLayer(
                event.worldX, event.worldY, shareData
            );
        }

        if (isInsideSelection) {
            return 'pointer';
        }

        // 检查是否在选择边框上
        const isOnBorder = (shareData.tgfxBaseView as any)?.isPointInSelectionBorder?.(
            event.worldX, event.worldY
        );
        if (isOnBorder) {
            return 'move';
        }

        return null;
    }

    isActive(): boolean {
        return this.state !== SelectToolState.IDLE;
    }

    reset(): void {
        this.state = SelectToolState.IDLE;
        this.hasMoved = false;
        this.lastScreenX = 0;
        this.lastScreenY = 0;
    }
}
