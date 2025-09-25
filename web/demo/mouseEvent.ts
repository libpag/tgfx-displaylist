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

import {TGFXBaseView, ShareData, shareData, draw, animationLoop} from './common';

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 1000.0;

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

function ThrottleWithTrailing(delay: number) {
    return function (
        target: Object,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        const originalMethod = descriptor.value;

        let lastExecutionTime = 0;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let lastArgs: any[] | null = null;
        let lastThis: any = null;

        const invoke = () => {
            lastExecutionTime = Date.now();
            timeoutId = null;
            originalMethod.apply(lastThis, lastArgs);
            lastArgs = null;
            lastThis = null;
        };

        descriptor.value = function (...args: any[]) {
            const now = Date.now();

            if (now - lastExecutionTime >= delay) {
                lastExecutionTime = now;
                originalMethod.apply(this, args);
            } else {
                lastArgs = args;
                lastThis = this;

                if (!timeoutId) {
                    const remainingTime = delay - (now - lastExecutionTime);
                    timeoutId = setTimeout(invoke, remainingTime);
                }
            }
        };

        return descriptor;
    };
}

function ConvertCoordinates(e: MouseEvent, canvas: HTMLElement) {
    const rect = canvas.getBoundingClientRect();
    return {
        clientX: (e.clientX - rect.left) * window.devicePixelRatio,
        clientY: (e.clientY - rect.top) * window.devicePixelRatio
    };
}

// 屏幕坐标转换为世界坐标（考虑缩放和偏移）
function screenToWorld(screenX: number, screenY: number, shareData: ShareData) {
    const worldX = (screenX - shareData.offsetX) / shareData.zoom;
    const worldY = (screenY - shareData.offsetY) / shareData.zoom;
    return {worldX, worldY};
}

// 屏幕增量转换为世界增量（考虑缩放和偏移）
function screenDeltaToWorldDelta(deltaX: number, deltaY: number, shareData: ShareData) {
    const worldDeltaX = deltaX / shareData.zoom;
    const worldDeltaY = deltaY / shareData.zoom;
    return {worldDeltaX, worldDeltaY};
}

export type ZoomChangeCallback = (zoom: number) => void;

export class GestureManager {
    private scaleY = 1.0;
    private zoomChangeCallbacks: ZoomChangeCallback[] = [];
    private pinchTimeout = 150; // 毫秒
    private timer: number | undefined;
    private scaleStartZoom = 1.0;

    private lastEventTime = 0;
    private lastDeltaY = 0;
    private timeThreshold = 50; // 毫秒
    private deltaYThreshold = 50;
    private deltaYChangeThreshold = 10;
    private mouseWheelRatio = 800;
    private touchWheelRatio = 100;

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
        if (isMouseDown) {
            hasMoved = true;

            const clientXY = ConvertCoordinates(event, canvas);
            const screenDeltaX = clientXY.clientX - lastPointX;
            const screenDeltaY = clientXY.clientY - lastPointY;

            // 只有当增量不为零时才处理移动
            if (screenDeltaX !== 0 || screenDeltaY !== 0) {
                // 直接使用屏幕增量，让后端处理坐标变换
                try {
                    shareData.tgfxBaseView?.moveHighlightLayer(screenDeltaX, screenDeltaY);
                } catch (error) {
                    console.error('移动图层时出错:', error);
                }

                // 更新lastPoint
                lastPointX = clientXY.clientX;
                lastPointY = clientXY.clientY;

                shareData.tgfxBaseView?.markDirty();
                animationLoop(shareData);
            }

            return;
        }

        // 鼠标悬停高亮
        const clientXY = ConvertCoordinates(event, canvas);
        const worldCoords = screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
        const reDraw = shareData.tgfxBaseView?.highlightLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
        if (reDraw) {
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }
    }

    public onMouseLeave(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        // 鼠标离开canvas时的处理
    }

    public onMouseDown(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        if (event.button === 0) { // 判断是否为左键
            const clientXY = ConvertCoordinates(event, canvas);
            const worldCoords = screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

            shareData.tgfxBaseView?.resetHighlightLayer();
            if (shareData.tgfxBaseView?.selectMoveLayer(worldCoords.worldX, worldCoords.worldY)) {
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
            if (!hasMoved) {
                const clientXY = ConvertCoordinates(event, canvas);
                const worldCoords = screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

            }

            // 重置状态
            isMouseDown = false;
            hasMoved = false;
        }
    }

    public onClick(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        const clientXY = ConvertCoordinates(event, canvas);
        const worldCoords = screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

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