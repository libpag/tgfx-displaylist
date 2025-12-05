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

/**
 * 鼠标事件数据
 */
export interface MouseEventData {
    screenX: number;      // 屏幕坐标 X（已转换为像素）
    screenY: number;      // 屏幕坐标 Y（已转换为像素）
    worldX: number;       // 世界坐标 X
    worldY: number;       // 世界坐标 Y
    button: number;       // 鼠标按键
    shiftKey: boolean;    // Shift 键是否按下
    ctrlKey: boolean;     // Ctrl 键是否按下
    altKey: boolean;      // Alt 键是否按下
}

/**
 * 工具接口
 * 
 * 所有交互工具都必须实现此接口。
 * 工具负责处理特定类型的交互（如选择、缩放、旋转等）。
 */
export interface ITool {
    /** 工具名称 */
    readonly name: string;

    /**
     * 鼠标按下事件
     * @param event 鼠标事件数据
     * @param canvas Canvas 元素
     * @param shareData 共享数据
     * @returns 是否消费了此事件（如果返回 true，事件不会传递给其他工具）
     */
    onMouseDown(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): boolean;

    /**
     * 鼠标移动事件
     * @param event 鼠标事件数据
     * @param canvas Canvas 元素
     * @param shareData 共享数据
     * @returns 是否消费了此事件
     */
    onMouseMove(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): boolean;

    /**
     * 鼠标抬起事件
     * @param event 鼠标事件数据
     * @param canvas Canvas 元素
     * @param shareData 共享数据
     * @returns 是否消费了此事件
     */
    onMouseUp(event: MouseEventData, canvas: HTMLElement, shareData: ShareData): boolean;

    /**
     * 获取当前光标样式
     * @param event 鼠标事件数据
     * @param shareData 共享数据
     * @returns 光标样式字符串，如果返回 null 则使用默认光标
     */
    getCursor(event: MouseEventData, shareData: ShareData): string | null;

    /**
     * 工具是否处于活动状态（正在处理交互）
     */
    isActive(): boolean;

    /**
     * 重置工具状态
     */
    reset(): void;

    /**
     * 工具被激活时调用
     */
    onActivate?(): void;

    /**
     * 工具被停用时调用
     */
    onDeactivate?(): void;
}

/**
 * 工具类型枚举
 */
export enum ToolType {
    SELECT = 'select',
    SCALE = 'scale',
    ROTATE = 'rotate',
    HAND = 'hand',
}
