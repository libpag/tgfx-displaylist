import {TGFXBaseView, ShareData, shareData, draw, animationLoop} from './common';

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

    // 创建方向箭头光标
    private createArrowCursor(direction: string): string {
        const svgMap: { [key: string]: string } = {
            // ↘ 右下方向
            'se-resize': `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4L20 20" stroke="black" stroke-width="3"/>
                <path d="M20 20L14 20L20 14Z" fill="black"/>
            </svg>`,

            // ↙ 左下方向
            'sw-resize': `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 4L4 20" stroke="black" stroke-width="3"/>
                <path d="M4 20L10 20L4 14Z" fill="black"/>
            </svg>`,

            // ↗ 右上方向
            'ne-resize': `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 20L20 4" stroke="black" stroke-width="3"/>
                <path d="M20 4L14 4L20 10Z" fill="black"/>
            </svg>`,

            // ↖ 左上方向
            'nw-resize': `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 20L4 4" stroke="black" stroke-width="3"/>
                <path d="M4 4L10 4L4 10Z" fill="black"/>
            </svg>`,

            // 旋转
            'rotate': `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 9.5 4 7.26 5.64 5.64" stroke="black" stroke-width="2" fill="none"/>
                <path d="M9 5L5.64 5.64L6.28 9Z" fill="black"/>
            </svg>`
        };

        const svg = svgMap[direction] || svgMap['nw-resize'];
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

    // 获取光标（带缓存）
    getCursor(type: string): string {
        if (this.cursorCache.has(type)) {
            return this.cursorCache.get(type)!;
        }

        let cursor: string;
        if (type === 'rotate') {
            cursor = this.createRotateCursor();
        } else if (['nw-resize', 'ne-resize', 'sw-resize', 'se-resize'].includes(type)) {
            cursor = this.createArrowCursor(type);
        } else {
            cursor = type; // 使用系统默认光标
        }

        this.cursorCache.set(type, cursor);
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
        // 优先尝试使用 C++ 端的坐标转换
        if (shareData.tgfxBaseView && typeof (shareData.tgfxBaseView as any).screenToWorld === 'function') {
            try {
                const result = (shareData.tgfxBaseView as any).screenToWorld(screenX, screenY);
                if (result && typeof result.x === 'number' && typeof result.y === 'number') {
                    return { worldX: result.x, worldY: result.y };
                }
            } catch (error) {
                // C++ 转换失败，降级到 JavaScript 实现
            }
        }

        // JavaScript 降级实现
        const worldX = (screenX - shareData.offsetX) / shareData.zoom;
        const worldY = (screenY - shareData.offsetY) / shareData.zoom;
        return { worldX, worldY };
    }

    static screenDeltaToWorldDelta(deltaX: number, deltaY: number, shareData: ShareData): {worldDeltaX: number, worldDeltaY: number} {
        const worldDeltaX = deltaX / shareData.zoom;
        const worldDeltaY = deltaY / shareData.zoom;
        return { worldDeltaX, worldDeltaY };
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

            // 1. 首先检查角控制器（最高优先级）
            const cornerDetectionResult = this.detectCornerPosition(mouseX, mouseY, shareData);

            if (cornerDetectionResult && typeof cornerDetectionResult === 'object') {
                const { position, distance } = cornerDetectionResult;

                // 只要在角控制器检测范围内（距离 < 8 像素），就显示缩放光标
                if (distance < 8) {
                    // 返回对应的箭头光标类型
                    switch (position) {
                        case '左上角':
                            return 'nw-resize';
                        case '右上角':
                            return 'ne-resize';
                        case '左下角':
                            return 'sw-resize';
                        case '右下角':
                            return 'se-resize';
                        default:
                            return 'nw-resize';
                    }
                }
            }

            // 2. 检查是否在选择边框上（显示移动光标）
            // 注意：这里不需要排除角控制器，因为角控制器已经在上面处理了
            const isOnSelectionBorder = (shareData.tgfxBaseView as any).isPointInSelectionBorder &&
                (shareData.tgfxBaseView as any).isPointInSelectionBorder(worldCoords.worldX, worldCoords.worldY);

            if (isOnSelectionBorder) {
                return 'move';
            }

            // 3. 检查角控制器附近的旋转区域（距离 8-40 像素）
            if (cornerDetectionResult && typeof cornerDetectionResult === 'object') {
                const { distance } = cornerDetectionResult;
                if (distance >= 8 && distance < 40) {
                    // 在角控制器附近但不在上面，显示旋转光标
                    return 'rotate';
                }
            }

            // 检查是否在选中图层内部（如果有选中的图层）
            const isInSelectedLayer = this.isPointInSelectedLayer(worldCoords.worldX, worldCoords.worldY, shareData);

            // 检查旋转区域（但排除图层内部）
            const isInRotateZone = !isInSelectedLayer && 
                (shareData.tgfxBaseView as any).isPointInRotateZone &&
                (shareData.tgfxBaseView as any).isPointInRotateZone(worldCoords.worldX, worldCoords.worldY);

            if (isInRotateZone) {
                return 'rotate';
            }

            // 如果在选中图层内部，显示指针光标
            if (isInSelectedLayer) {
                return 'pointer';
            }

            return 'default';
        } catch (error) {
            return 'default';
        }
    }

    /**
     * 检查点是否在选中图层内部
     */
    private isPointInSelectedLayer(worldX: number, worldY: number, shareData: ShareData): boolean {
        if (!shareData.tgfxBaseView) return false;

        try {
            // 调用 C++ 方法检查点是否在选中图层内部
            const isInLayer = (shareData.tgfxBaseView as any).isPointInSelectedLayer &&
                (shareData.tgfxBaseView as any).isPointInSelectedLayer(worldX, worldY);
            
            return !!isInLayer;
        } catch (error) {
            console.error('检查选中图层失败:', error);
            return false;
        }
    }

    // 检测具体是哪个角控制器
    private detectCornerPosition(mouseX: number, mouseY: number, shareData: ShareData): { position: string; distance: number } | null {
        if (!shareData.tgfxBaseView) return null;

        try {
            // 使用优化的坐标转换器
            const worldCoords = CoordinateTransformer.screenToWorld(mouseX, mouseY, shareData);

            // 首先确认鼠标确实在角控制器区域附近
            if (!(shareData.tgfxBaseView as any).isPointInCornerHandle(worldCoords.worldX, worldCoords.worldY)) {
                return null;
            }

            // 检查函数是否存在
            if (typeof (shareData.tgfxBaseView as any).getSelectedLayerCorners !== 'function') {
                return null;
            }

            // 使用新的C++函数获取选中图层的4个顶点坐标
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();

            // 将 Emscripten vector 转换为 JavaScript 数组
            let corners: number[] = [];
            if (cornersVector && typeof cornersVector.size === 'function') {
                const size = cornersVector.size();
                for (let i = 0; i < size; i++) {
                    corners.push(cornersVector.get(i));
                }
            }

            if (!corners || corners.length !== 8) {
                return null;
            }

            // 解析坐标数组: [左上角x, 左上角y, 右上角x, 右上角y, 右下角x, 右下角y, 左下角x, 左下角y]
            const cornerData = [
                { name: '左上角', x: corners[0], y: corners[1] }, // 0
                { name: '右上角', x: corners[2], y: corners[3] }, // 1
                { name: '右下角', x: corners[4], y: corners[5] }, // 2
                { name: '左下角', x: corners[6], y: corners[7] }, // 3
            ];

            // 验证坐标数据的有效性
            const hasValidCoords = cornerData.every(corner =>
                typeof corner.x === 'number' && typeof corner.y === 'number' &&
                !isNaN(corner.x) && !isNaN(corner.y)
            );

            if (!hasValidCoords) {
                return null;
            }

            // 计算鼠标到每个角的距离
            const distances = cornerData.map(corner => {
                const dx = mouseX - corner.x;
                const dy = mouseY - corner.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                return { corner: corner.name, distance };
            });

            // 选择距离最近的角
            const nearest = distances.reduce((min, current) =>
                current.distance < min.distance ? current : min
            );

            return { position: nearest.corner, distance: nearest.distance };

        } catch (error) {
            return null; // 出错时返回 null
        }
    }
}

// 全局实例
const cursorFactory = CursorFactory.getInstance();
const cursorDetectionCache = new CursorDetectionCache();

// 设置光标样式（使用工厂模式）
function setCursor(canvas: HTMLElement, cursorType: string) {
    const cursor = cursorFactory.getCursor(cursorType);
    canvas.style.cursor = cursor;
}

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
                    if (shareData.tgfxBaseView) {
            shareData.tgfxBaseView.moveHighlightLayer(screenDeltaX, screenDeltaY);
        }
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
        const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
        const reDraw = shareData.tgfxBaseView?.highlightLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
        if (reDraw) {
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }

        // 光标检测和设置（使用缓存）
        const cursorType = cursorDetectionCache.detectCursorType(clientXY.clientX, clientXY.clientY, shareData);
        setCursor(canvas, cursorType);
    }

    public onMouseLeave(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        // 鼠标离开canvas时的处理
    }

    public onMouseDown(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        if (event.button === 0) { // 判断是否为左键
            const clientXY = ConvertCoordinates(event, canvas);
            const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

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
                // 单击事件：调用选中方法
                const clientXY = ConvertCoordinates(event, canvas);
                const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

                console.log(`[JS调试] 单击坐标：(${worldCoords.worldX}, ${worldCoords.worldY})`);
                const selected = shareData.tgfxBaseView?.selectLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
                console.log(`[JS调试] 选中结果：${selected}`);
            } else {
                shareData.tgfxBaseView.resetMoveLayers();
            }

            // 重置状态
            isMouseDown = false;
            hasMoved = false;

            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }
    }

    public onClick(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
        const clientXY = ConvertCoordinates(event, canvas);
        const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

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