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

import { ShareData, animationLoop } from '../common';
import { ITool, MouseEventData, ToolType } from './ITool';
import { InteractionConfig, CoordinateTransformer, CursorFactory } from './shared';

/**
 * 工具管理器
 * 
 * 负责管理所有工具，分发鼠标事件，处理工具切换。
 * 采用状态模式，当前只有一个"激活的工具"处理事件。
 */
export class ToolManager {
    private static instance: ToolManager;
    
    private tools: Map<ToolType, ITool> = new Map();
    private activeTool: ITool | null = null;
    private defaultToolType: ToolType = ToolType.SELECT;
    
    // 当前正在处理交互的工具（可能与 activeTool 不同）
    private interactingTool: ITool | null = null;
    
    // 光标工厂
    private cursorFactory = CursorFactory.getInstance();

    private constructor() {}

    static getInstance(): ToolManager {
        if (!ToolManager.instance) {
            ToolManager.instance = new ToolManager();
        }
        return ToolManager.instance;
    }

    /**
     * 注册工具
     */
    registerTool(type: ToolType, tool: ITool): void {
        this.tools.set(type, tool);
        console.log(`[ToolManager] 注册工具: ${type}`);
    }

    /**
     * 获取工具
     */
    getTool(type: ToolType): ITool | undefined {
        return this.tools.get(type);
    }

    /**
     * 切换到指定工具
     */
    switchTool(type: ToolType): boolean {
        const newTool = this.tools.get(type);
        if (!newTool) {
            console.error(`[ToolManager] 工具不存在: ${type}`);
            return false;
        }

        // 如果有正在交互的工具，不允许切换
        if (this.interactingTool && this.interactingTool.isActive()) {
            console.warn(`[ToolManager] 工具 ${this.interactingTool.name} 正在交互中，无法切换`);
            return false;
        }

        // 停用当前工具
        if (this.activeTool) {
            this.activeTool.onDeactivate?.();
        }

        // 激活新工具
        this.activeTool = newTool;
        this.activeTool.onActivate?.();
        
        console.log(`[ToolManager] 切换到工具: ${type}`);
        return true;
    }

    /**
     * 获取当前激活的工具
     */
    getActiveTool(): ITool | null {
        return this.activeTool;
    }

    /**
     * 设置默认工具
     */
    setDefaultTool(type: ToolType): void {
        this.defaultToolType = type;
    }

    /**
     * 切换到默认工具
     */
    switchToDefaultTool(): void {
        this.switchTool(this.defaultToolType);
    }

    /**
     * 将原生鼠标事件转换为 MouseEventData
     */
    convertMouseEvent(e: MouseEvent, canvas: HTMLElement, shareData: ShareData): MouseEventData {
        const rect = canvas.getBoundingClientRect();
        const screenX = (e.clientX - rect.left) * window.devicePixelRatio;
        const screenY = (e.clientY - rect.top) * window.devicePixelRatio;
        const worldCoords = CoordinateTransformer.screenToWorld(screenX, screenY, shareData);
        
        return {
            screenX,
            screenY,
            worldX: worldCoords.worldX,
            worldY: worldCoords.worldY,
            button: e.button,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
        };
    }

    /**
     * 处理鼠标按下事件
     */
    onMouseDown(e: MouseEvent, canvas: HTMLElement, shareData: ShareData): void {
        if (e.button !== 0) return; // 只处理左键

        const event = this.convertMouseEvent(e, canvas, shareData);

        // 尝试让各工具按优先级处理事件
        // 优先级：Scale > Rotate > Select
        const toolPriority = [ToolType.SCALE, ToolType.ROTATE, ToolType.SELECT];
        
        for (const toolType of toolPriority) {
            const tool = this.tools.get(toolType);
            if (tool && tool.onMouseDown(event, canvas, shareData)) {
                this.interactingTool = tool;
                this.markDirtyAndAnimate(shareData);
                return;
            }
        }

        // 如果没有工具处理，使用默认工具
        if (this.activeTool && this.activeTool.onMouseDown(event, canvas, shareData)) {
            this.interactingTool = this.activeTool;
            this.markDirtyAndAnimate(shareData);
        }
    }

    /**
     * 处理鼠标移动事件
     */
    onMouseMove(e: MouseEvent, canvas: HTMLElement, shareData: ShareData): void {
        const event = this.convertMouseEvent(e, canvas, shareData);

        // 如果有正在交互的工具，优先处理
        if (this.interactingTool && this.interactingTool.isActive()) {
            if (this.interactingTool.onMouseMove(event, canvas, shareData)) {
                this.markDirtyAndAnimate(shareData);
                return;
            }
        }

        // 否则更新光标
        this.updateCursor(event, canvas, shareData);

        // 处理悬停高亮
        const reDraw = shareData.tgfxBaseView?.highlightLayerAndCheckRedraw(event.worldX, event.worldY);
        if (reDraw) {
            this.markDirtyAndAnimate(shareData);
        }
    }

    /**
     * 处理鼠标抬起事件
     */
    onMouseUp(e: MouseEvent, canvas: HTMLElement, shareData: ShareData): void {
        if (e.button !== 0) return; // 只处理左键

        const event = this.convertMouseEvent(e, canvas, shareData);

        // 如果有正在交互的工具，让它处理
        if (this.interactingTool) {
            this.interactingTool.onMouseUp(event, canvas, shareData);
            this.interactingTool = null;
            this.markDirtyAndAnimate(shareData);
            return;
        }

        // 否则让激活的工具处理
        if (this.activeTool) {
            this.activeTool.onMouseUp(event, canvas, shareData);
            this.markDirtyAndAnimate(shareData);
        }
    }

    /**
     * 更新光标样式
     */
    private updateCursor(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): void {
        // 按优先级询问各工具的光标
        const toolPriority = [ToolType.SCALE, ToolType.ROTATE, ToolType.SELECT];
        
        for (const toolType of toolPriority) {
            const tool = this.tools.get(toolType);
            if (tool) {
                const cursor = tool.getCursor(event, shareData);
                if (cursor) {
                    this.setCursor(canvas, cursor);
                    return;
                }
            }
        }

        // 默认光标
        this.setCursor(canvas, 'default');
    }

    /**
     * 设置光标样式
     */
    private setCursor(canvas: HTMLElement, cursorType: string): void {
        const cursor = this.cursorFactory.getCursor(cursorType, 0);
        canvas.style.cursor = cursor;
    }

    /**
     * 标记脏并触发动画循环
     */
    private markDirtyAndAnimate(shareData: ShareData): void {
        shareData.tgfxBaseView?.markDirty();
        animationLoop(shareData);
    }

    /**
     * 重置所有工具状态
     */
    resetAllTools(): void {
        this.tools.forEach(tool => tool.reset());
        this.interactingTool = null;
    }
}

// 导出单例
export const toolManager = ToolManager.getInstance();
