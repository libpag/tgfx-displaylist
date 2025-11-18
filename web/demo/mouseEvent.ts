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

            // 1. 首先检查角控制器（最高优先级）- 单选和多选都支持
            const cornerDetectionResult = this.detectCornerPosition(mouseX, mouseY, shareData);

            if (cornerDetectionResult && typeof cornerDetectionResult === 'object') {
                const { position, distance } = cornerDetectionResult;

                // 只要在角控制器检测范围内（距离 < 8 像素），就显示缩放光标
                if (distance < 8) {
                    console.log(`[光标检测] ${isMultiSelection ? '多选' : '单选'}模式 - 检测到角控制器：${position}，距离：${distance.toFixed(2)}`);
                    
                    // 获取检测到的位置对应的索引
                    const cornerIndexMap: { [key: string]: number } = {
                        '左上角': 0, '右上角': 1, '右下角': 2, '左下角': 3
                    };
                    const detectedIndex = cornerIndexMap[position] ?? 0;
                    
                    // 单选模式才获取翻转状态（多选模式使用AABB，不需要翻转信息）
                    if (!isMultiSelection) {
                        const actualCornerName = (shareData.tgfxBaseView as any).getCornerNameByPosition(detectedIndex);
                        const flipStateVector = (shareData.tgfxBaseView as any).getSelectedLayerFlipState();
                        let isFlippedX = false;
                        let isFlippedY = false;
                        if (flipStateVector && flipStateVector.size && flipStateVector.size() >= 2) {
                            isFlippedX = flipStateVector.get(0) > 0.5;
                            isFlippedY = flipStateVector.get(1) > 0.5;
                        }
                        console.log(`[光标检测-单选] 实际位置：${actualCornerName} (索引${detectedIndex})，翻转状态：X=${isFlippedX}, Y=${isFlippedY}`);
                    }
                    
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
                    console.log(`[光标检测] → 返回缩放光标：${cursorType}`);
                    return cursorType;
                }
            }

            // 2. 检查角控制器附近的旋转区域（距离 8-40 像素）- 单选和多选都支持
            if (cornerDetectionResult && typeof cornerDetectionResult === 'object') {
                const { distance } = cornerDetectionResult;
                if (distance >= 8 && distance < 40) {
                    console.log(`[光标检测] ${isMultiSelection ? '多选' : '单选'}模式 - 检测到旋转区域，距离：${distance.toFixed(2)}`);
                    console.log(`[光标检测] → 返回旋转光标`);
                    return 'rotate';
                }
            }

            // 3. 检查是否在选择边框上（显示移动光标）
            // 注意：只有当不在角控制器和旋转区域时才检查边框
            const isOnSelectionBorder = (shareData.tgfxBaseView as any).isPointInSelectionBorder &&
                (shareData.tgfxBaseView as any).isPointInSelectionBorder(worldCoords.worldX, worldCoords.worldY);

            if (isOnSelectionBorder) {
                console.log(`[光标检测] ${isMultiSelection ? '多选' : '单选'}模式 - 检测到选择边框`);
                console.log(`[光标检测] → 返回移动光标`);
                return 'move';
            }

            // 检查是否在选中图层内部（如果有选中的图层）
            const isInSelectedLayer = this.isPointInSelectedLayer(worldCoords.worldX, worldCoords.worldY, shareData);

            // 检查旋转区域（但排除图层内部）
            const isInRotateZone = !isInSelectedLayer && 
                (shareData.tgfxBaseView as any).isPointInRotateZone &&
                (shareData.tgfxBaseView as any).isPointInRotateZone(worldCoords.worldX, worldCoords.worldY);

            if (isInRotateZone) {
                console.log(`[光标检测] 检测到旋转区域（边界外）`);
                console.log(`[光标检测] → 返回旋转光标`);
                return 'rotate';
            }

            // 如果在选中图层内部，显示指针光标
            if (isInSelectedLayer) {
                return 'pointer';
            }

            return 'default';
        } catch (error) {
            console.error('[光标检测] 检测失败:', error);
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
    public detectCornerPosition(mouseX: number, mouseY: number, shareData: ShareData): { position: string; distance: number } | null {
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

// 设置光标样式（使用工厂模式，支持旋转）
function setCursor(canvas: HTMLElement, cursorType: string, shareData?: ShareData) {
    let rotationAngle = 0;
    
    // 如果是缩放光标且有选中图层，获取旋转角度
    if (['nw-resize', 'ne-resize', 'sw-resize', 'se-resize'].includes(cursorType) && 
        shareData && shareData.tgfxBaseView) {
        try {
            rotationAngle = (shareData.tgfxBaseView as any).getSelectedLayerRotation();
            const rotationDegrees = rotationAngle * 180 / Math.PI;
            console.log(`[光标调试] 角位置: ${cursorType}, 旋转角度: ${rotationDegrees.toFixed(2)}°`);
        } catch (error) {
            console.error('获取旋转角度失败:', error);
        }
    }
    
    const cursor = cursorFactory.getCursor(cursorType, rotationAngle);
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

// 缩放状态管理器
class ScaleStateManager {
    private static instance: ScaleStateManager;
    private isScaling = false;
    private lastPoint = { x: 0, y: 0 }; // 上一帧的鼠标位置
    private cachedCenter: { x: number, y: number } | null = null;
    private lastDistance = 0; // 上一帧的距离
    private cornerIndex = -1; // 0:左上, 1:右上, 2:右下, 3:左下
    private oppositeCornerLocal: { x: number, y: number } | null = null; // 对角点的本地坐标（不变）
    private isMultiSelectionMode = false; // 是否为多选模式
    // 多选模式的翻转状态追踪（因为多选没有单一图层的翻转状态）
    private multiSelectionFlippedX = false;
    private multiSelectionFlippedY = false;

    static getInstance(): ScaleStateManager {
        if (!ScaleStateManager.instance) {
            ScaleStateManager.instance = new ScaleStateManager();
        }
        return ScaleStateManager.instance;
    }

    startScaling(startX: number, startY: number, centerX: number, centerY: number, cornerIdx: number, localX: number, localY: number, isMultiSelection = false): void {
        this.isScaling = true;
        this.lastPoint = { x: startX, y: startY };
        this.cachedCenter = { x: centerX, y: centerY };
        this.cornerIndex = cornerIdx;  // 存储视觉位置索引，用于翻转判断
        this.oppositeCornerLocal = { x: localX, y: localY }; // 记录本地坐标
        this.isMultiSelectionMode = isMultiSelection; // 记录模式
        
        // 重置多选翻转状态
        if (isMultiSelection) {
            this.multiSelectionFlippedX = false;
            this.multiSelectionFlippedY = false;
        }

        const deltaX = startX - centerX;
        const deltaY = startY - centerY;
        this.lastDistance = Math.hypot(deltaX, deltaY);
        
        console.log(`[缩放开始] ${isMultiSelection ? '多选' : '单选'}模式，操作视觉角索引${cornerIdx}，固定对角点坐标：(${centerX.toFixed(1)}, ${centerY.toFixed(1)})`);
    }

    endScaling(): void {
        console.log(`[缩放结束] 操作完成`);
        
        this.isScaling = false;
        this.cachedCenter = null;
        this.cornerIndex = -1;
        this.lastDistance = 0;
        this.oppositeCornerLocal = null;
        this.isMultiSelectionMode = false;
        this.multiSelectionFlippedX = false;
        this.multiSelectionFlippedY = false;
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

    // 多选模式专用：计算等比例缩放，支持翻转检测
    calculateMultiSelectionScale(currentX: number, currentY: number, oppositeCenterX: number, oppositeCenterY: number): { scaleX: number, scaleY: number } {
        const deltaX = currentX - oppositeCenterX;
        const deltaY = currentY - oppositeCenterY;
        
        // 判断是否应该翻转（基于鼠标相对对角点的位置）
        const shouldFlipX = this.shouldFlipX(currentX, oppositeCenterX);
        const shouldFlipY = this.shouldFlipY(currentY, oppositeCenterY);
        
        // 打印翻转判断详情（每10帧打印一次）
        if (performance.now() % 100 < 16) {
            const cornerNames = ['左上角', '右上角', '右下角', '左下角'];
            const visualCornerName = cornerNames[this.cornerIndex] || '未知';
            console.log(`[翻转判断-多选] 视觉操作角：${visualCornerName}(索引${this.cornerIndex})，鼠标:(${currentX.toFixed(1)},${currentY.toFixed(1)})，对角点:(${oppositeCenterX.toFixed(1)},${oppositeCenterY.toFixed(1)})`);
            console.log(`[翻转判断-多选] 当前状态：FlipX=${this.multiSelectionFlippedX}, FlipY=${this.multiSelectionFlippedY}，应该状态：shouldFlipX=${shouldFlipX}, shouldFlipY=${shouldFlipY}`);
        }
        
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
            const cornerNames = ['左上角', '右上角', '右下角', '左下角'];
            const visualCornerName = cornerNames[this.cornerIndex] || '未知';
            console.log(`\n[翻转发生-多选] ==================`);
            console.log(`[翻转发生-多选] 视觉操作角：${visualCornerName} (索引${this.cornerIndex})`);
            console.log(`[翻转发生-多选] 鼠标位置：(${currentX.toFixed(2)}, ${currentY.toFixed(2)})`);
            console.log(`[翻转发生-多选] 对角点位置：(${oppositeCenterX.toFixed(2)}, ${oppositeCenterY.toFixed(2)})`);
            
            if (needFlipX) {
                scaleX = -1.0;
                this.multiSelectionFlippedX = shouldFlipX;
                console.log(`[翻转发生-多选] X轴翻转: ${!shouldFlipX} -> ${shouldFlipX}`);
            }
            if (needFlipY) {
                scaleY = -1.0;
                this.multiSelectionFlippedY = shouldFlipY;
                console.log(`[翻转发生-多选] Y轴翻转: ${!shouldFlipY} -> ${shouldFlipY}`);
            }
            console.log(`[翻转发生-多选] ==================\n`);
            
            // ⭐ 关键：同步翻转状态到旋转管理器，以便旋转时正确反转方向
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

    // 计算增量缩放因子（基于鼠标到对角点的距离变化），并检测翻转（仅单选模式）
    calculateIncrementalScaleFactor(currentX: number, currentY: number, oppositeCenterX: number, oppositeCenterY: number): { scaleX: number, scaleY: number } {
        // 计算当前鼠标相对于对角点的向量
        const deltaX = currentX - oppositeCenterX;
        const deltaY = currentY - oppositeCenterY;
        
        // 判断是否应该翻转（基于鼠标相对对角点的位置）
        const shouldFlipX = this.shouldFlipX(currentX, oppositeCenterX);
        const shouldFlipY = this.shouldFlipY(currentY, oppositeCenterY);
        
        // 获取当前图层的翻转状态（从C++读取）
        const flipStateVector = (shareData.tgfxBaseView as any).getSelectedLayerFlipState();
        let currentFlippedX = false;
        let currentFlippedY = false;
        if (flipStateVector && flipStateVector.size && flipStateVector.size() >= 2) {
            currentFlippedX = flipStateVector.get(0) > 0.5;
            currentFlippedY = flipStateVector.get(1) > 0.5;
        }
        
        // 打印翻转判断详情（每10帧打印一次，避免刷屏）
        if (performance.now() % 100 < 16) {
            const cornerNames = ['左上角', '右上角', '右下角', '左下角'];
            const visualCornerName = cornerNames[this.cornerIndex] || '未知';
            console.log(`[翻转判断] 视觉操作角：${visualCornerName}(索引${this.cornerIndex})，鼠标:(${currentX.toFixed(1)},${currentY.toFixed(1)})，对角点:(${oppositeCenterX.toFixed(1)},${oppositeCenterY.toFixed(1)})`);
            console.log(`[翻转判断] 当前状态：FlipX=${currentFlippedX}, FlipY=${currentFlippedY}，应该状态：shouldFlipX=${shouldFlipX}, shouldFlipY=${shouldFlipY}`);
        }
        
        // 根据翻转状态调整向量方向，计算有效距离
        const effectiveDeltaX = shouldFlipX ? -deltaX : deltaX;
        const effectiveDeltaY = shouldFlipY ? -deltaY : deltaY;
        const currentDistance = Math.hypot(effectiveDeltaX, effectiveDeltaY);
        
        if (this.lastDistance === 0) {
            // 第一次调用，初始化距离
            this.lastDistance = currentDistance;
            return { scaleX: 1.0, scaleY: 1.0 };
        }
        
        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // 检查是否需要翻转（当前应该翻转 != 实际已翻转）
        const needFlipX = shouldFlipX !== currentFlippedX;
        const needFlipY = shouldFlipY !== currentFlippedY;
        
        if (needFlipX || needFlipY) {
            // 发生翻转
            const cornerNames = ['左上角', '右上角', '右下角', '左下角'];
            const visualCornerName = cornerNames[this.cornerIndex] || '未知';
            console.log(`\n[翻转发生] ==================`);
            console.log(`[翻转发生] 视觉操作角：${visualCornerName} (索引${this.cornerIndex})`);
            console.log(`[翻转发生] 鼠标位置：(${currentX.toFixed(2)}, ${currentY.toFixed(2)})`);
            console.log(`[翻转发生] 对角点位置：(${oppositeCenterX.toFixed(2)}, ${oppositeCenterY.toFixed(2)})`);
            
            if (needFlipX) {
                scaleX = -1.0;
                console.log(`[翻转发生] X轴翻转: ${currentFlippedX} -> ${shouldFlipX}`);
            }
            if (needFlipY) {
                scaleY = -1.0;
                console.log(`[翻转发生] Y轴翻转: ${currentFlippedY} -> ${shouldFlipY}`);
            }
            console.log(`[翻转发生] ==================\n`);
            
            this.lastDistance = Math.max(currentDistance, Number.EPSILON);
        } else {
            // 没有翻转，正常计算缩放因子
            const scaleFactor = currentDistance / this.lastDistance;
            scaleX = scaleFactor;
            scaleY = scaleFactor;
            // 更新上一帧的距离
            this.lastDistance = currentDistance;
        }
        
        this.lastPoint = { x: currentX, y: currentY };
        
        return { scaleX, scaleY };
    }
    
    // 检测X轴是否应该翻转（基于当前角的初始位置）
    private shouldFlipX(currentX: number, centerX: number): boolean {
        // 根据角索引判断是左侧还是右侧
        const isLeftCorner = (this.cornerIndex === 0 || this.cornerIndex === 3);
        
        if (isLeftCorner) {
            // 左侧角 -> 鼠标在中心点右侧时表示翻转
            return currentX > centerX;
        } else {
            // 右侧角 -> 鼠标在中心点左侧时表示翻转
            return currentX < centerX;
        }
    }
    
    // 检测Y轴是否应该翻转（基于当前角的初始位置）
    private shouldFlipY(currentY: number, centerY: number): boolean {
        // 根据角索引判断是上侧还是下侧
        const isTopCorner = (this.cornerIndex === 0 || this.cornerIndex === 1);
        
        if (isTopCorner) {
            // 上侧角 -> 鼠标在中心点下方时表示翻转
            return currentY > centerY;
        } else {
            // 下侧角 -> 鼠标在中心点上方时表示翻转
            return currentY < centerY;
        }
    }
}

const scaleStateManager = ScaleStateManager.getInstance();

// ========== 框选管理器 ==========
class BoxSelectionManager {
    private isSelecting = false;
    private hasDragStarted = false;
    private isPrepared = false;  // 标记是否已准备好框选（只有在点击空白区域时才为true）
    private startScreenX = 0;
    private startScreenY = 0;
    private startWorldX = 0;
    private startWorldY = 0;
    private minDragDistance = 15;  // 15像素阈值（增加拖动距离，避免误触发）
    private minPressTime = 500;    // 最小按压时间（毫秒）- 需要按下至少500ms才能启动框选
    private pressStartTime = 0;    // 按下时的时间戳

    // 记录初始点击位置（只在点击空白区域时调用）
    onMouseDown(screenX: number, screenY: number, worldX: number, worldY: number): void {
        this.startScreenX = screenX;
        this.startScreenY = screenY;
        this.startWorldX = worldX;
        this.startWorldY = worldY;
        this.hasDragStarted = false;
        this.isPrepared = true;  // 标记已准备好框选
        this.pressStartTime = Date.now();  // 记录按下时间
        console.log('[框选管理器] 准备框选，起点：', screenX, screenY);
    }

    // 判断是否应该启动框选
    onMouseMove(currentScreenX: number, currentScreenY: number, worldX: number, worldY: number, shareData: ShareData): void {
        // 如果没有准备好框选（例如点击的是图层），不启动框选
        if (!this.isPrepared) {
            return;
        }
        
        const dx = currentScreenX - this.startScreenX;
        const dy = currentScreenY - this.startScreenY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const pressDuration = Date.now() - this.pressStartTime;

        // 需要同时满足距离和时间条件
        if (!this.hasDragStarted && distance > this.minDragDistance && pressDuration > this.minPressTime) {
            // 超过阈值，启动框选
            this.hasDragStarted = true;
            this.isSelecting = true;
            (shareData.tgfxBaseView as any).startBoxSelection(this.startWorldX, this.startWorldY);
            console.log(`[框选] 启动框选，起点：(${this.startWorldX.toFixed(2)}, ${this.startWorldY.toFixed(2)})，按压时长：${pressDuration}ms`);
        }

        if (this.isSelecting) {
            // 更新框选框
            (shareData.tgfxBaseView as any).updateBoxSelection(worldX, worldY);
        }
    }

    // 鼠标抬起
    onMouseUp(shareData: ShareData): void {
        if (this.isSelecting) {
            (shareData.tgfxBaseView as any).endBoxSelection();
            console.log('[框选] 结束框选');
        }

        this.isSelecting = false;
        this.hasDragStarted = false;
        this.isPrepared = false;  // 重置准备状态
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
        // 检测是否为多选模式（通过ID识别）
        const isMultiSelection = currentLayerId === '__MULTI_SELECTION__';
        
        // 如果选中了新的图层，重置旋转状态
        if (currentLayerId && currentLayerId !== this.lastSelectedLayerId) {
            console.log(`[旋转状态] 检测到新图层，重置旋转累积值`);
            this.totalRotation = 0;
            this.lastSelectedLayerId = currentLayerId;
            
            // 多选模式重置翻转状态
            if (isMultiSelection) {
                this.multiSelectionFlippedX = false;
                this.multiSelectionFlippedY = false;
            }
        }
        
        this.isRotating = true;
        this.isMultiSelectionMode = isMultiSelection;
        this.lastPoint = { x: startX, y: startY };
        this.cachedCenter = { x: centerX, y: centerY };
        // 不在这里重置 totalRotation，保留上面的逻辑
        this.cachedDistance = Math.hypot(startX - centerX, startY - centerY);
        console.log(`[旋转状态] 开始旋转，${isMultiSelection ? '多选' : '单选'}模式，缓存中心点：(${centerX}, ${centerY})，半径：${this.cachedDistance.toFixed(2)}`);
    }

    endRotation(): void {
        this.isRotating = false;
        this.cachedCenter = null;
        this.cachedDistance = 0;
        this.isMultiSelectionMode = false;
        this.multiSelectionFlippedX = false;
        this.multiSelectionFlippedY = false;
        
        console.log(`[旋转状态] 结束旋转，总旋转角度：${(this.totalRotation * 180 / Math.PI).toFixed(2)}°`);
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
        
        // 计算上一个位置和当前位置相对于中心点的向量
        const lastVector = { x: lastX - centerX, y: lastY - centerY };
        const currentVector = { x: currentX - centerX, y: currentY - centerY };

        // 避免半径过小导致数值不稳定
        const lastRadius = Math.hypot(lastVector.x, lastVector.y);
        const currentRadius = Math.hypot(currentVector.x, currentVector.y);
        const fallbackRadius = Math.max(this.cachedDistance, Number.EPSILON);
        const minRadius = Math.max(fallbackRadius * 0.25, 1e-3);
        if (lastRadius < minRadius || currentRadius < minRadius) {
            console.warn('[旋转] 半径过小，忽略此次旋转增量');
            return 0;
        }
        
        // 计算角度差（增量）
        const lastAngle = Math.atan2(lastVector.y, lastVector.x);
        const currentAngle = Math.atan2(currentVector.y, currentVector.x);
        
        let deltaAngle = currentAngle - lastAngle;
        
        // 处理角度跨越-π到π的边界情况
        if (deltaAngle > Math.PI) {
            deltaAngle -= 2 * Math.PI;
        } else if (deltaAngle < -Math.PI) {
            deltaAngle += 2 * Math.PI;
        }

        // 详细的调试输出
        const lastAngleDeg = lastAngle * 180 / Math.PI;
        const currentAngleDeg = currentAngle * 180 / Math.PI;
        const originalDeltaAngleDeg = deltaAngle * 180 / Math.PI;
        let deltaAngleDeg = originalDeltaAngleDeg;
        let accumulatedAngleDeg = (this.totalRotation + deltaAngle) * 180 / Math.PI;

        // 获取翻转状态（单选/多选分别处理）
        let isFlippedX = false;
        let isFlippedY = false;
        
        if (this.isMultiSelectionMode) {
            // 多选模式：使用自己追踪的翻转状态
            isFlippedX = this.multiSelectionFlippedX;
            isFlippedY = this.multiSelectionFlippedY;
        } else if (shareData) {
            // 单选模式：从C++读取当前图层的翻转状态
            const flipStateVector = (shareData.tgfxBaseView as any).getSelectedLayerFlipState();
            if (flipStateVector && flipStateVector.size && flipStateVector.size() >= 2) {
                isFlippedX = flipStateVector.get(0) > 0.5;
                isFlippedY = flipStateVector.get(1) > 0.5;
            }
        }
        
        // 添加向量计算的调试输出
        console.log(`[旋转角度] 上次向量: (${lastVector.x.toFixed(1)}, ${lastVector.y.toFixed(1)}), 当前向量: (${currentVector.x.toFixed(1)}, ${currentVector.y.toFixed(1)})`);
        console.log(`[旋转角度] 原始角度变化: ${originalDeltaAngleDeg.toFixed(4)}°`);
        
        // 只有当有奇数个轴翻转时，才需要反转旋转方向
        // 根据翻转状态调整旋转方向
        // 经过测试发现：X=true,Y=false 时需要反转，Y=true,X=false 时也需要反转
        if (isFlippedX && !isFlippedY) {
            // 只有X轴翻转时，需要反转旋转方向
            deltaAngle = -deltaAngle;
            deltaAngleDeg = -deltaAngleDeg;
            accumulatedAngleDeg = (this.totalRotation + deltaAngle) * 180 / Math.PI;
            console.log(`[旋转角度] 检测到X轴翻转，反转旋转方向: ${originalDeltaAngleDeg.toFixed(4)}° -> ${deltaAngleDeg.toFixed(4)}°`);
        } else if (isFlippedY && !isFlippedX) {
            // 只有Y轴翻转时，需要反转旋转方向
            deltaAngle = -deltaAngle;
            deltaAngleDeg = -deltaAngleDeg;
            accumulatedAngleDeg = (this.totalRotation + deltaAngle) * 180 / Math.PI;
            console.log(`[旋转角度] 检测到Y轴翻转，反转旋转方向: ${originalDeltaAngleDeg.toFixed(4)}° -> ${deltaAngleDeg.toFixed(4)}°`);
        } else {
            console.log(`[旋转角度] 双轴翻转或无翻转，保持旋转方向: ${deltaAngleDeg.toFixed(4)}°`);
        }
        
        console.log(`[旋转角度] ${this.isMultiSelectionMode ? '多选' : '单选'}翻转状态: X=${isFlippedX}, Y=${isFlippedY}`);
        console.log(`[旋转角度] 鼠标从(${lastX.toFixed(1)}, ${lastY.toFixed(1)})移动到(${currentX.toFixed(1)}, ${currentY.toFixed(1)})`);
        console.log(`[旋转角度] 中心点(${centerX.toFixed(1)}, ${centerY.toFixed(1)})`);
        console.log(`[旋转角度] 上次角度: ${lastAngleDeg.toFixed(2)}°, 当前角度: ${currentAngleDeg.toFixed(2)}°, 变化: ${deltaAngleDeg.toFixed(4)}°, 累计: ${accumulatedAngleDeg.toFixed(2)}°`);

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
            const minimumUsableRadius = Math.max(radius * 0.25, 1e-3);
            if (currentRadius < minimumUsableRadius) {
                console.warn('[旋转JS] 当前半径过小，忽略旋转');
                return;
            }

            // 计算增量旋转角度（使用缓存的中心点）
            const deltaAngle = rotationStateManager.calculateIncrementalRotationAngle(
                currentWorldCoords.worldX, currentWorldCoords.worldY, shareData
            );

            const angleDegrees = deltaAngle * 180 / Math.PI;
            
            if (Math.abs(deltaAngle) > 0) { // 只要有角度变化就旋转
                // 检测是否处于多选模式
                const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                         (shareData.tgfxBaseView as any).isInMultiSelectionMode();
                
                if (isMultiSelection) {
                    console.log(`[旋转JS-多选] 执行旋转 - 角度: ${angleDegrees.toFixed(4)}°`);
                    // 多选模式：调用多选旋转方法
                    (shareData.tgfxBaseView as any).rotateMultiSelection(deltaAngle);
                } else {
                    console.log(`[旋转JS-单选] 执行旋转 - 角度: ${angleDegrees.toFixed(4)}°`);
                    // 单选模式：调用单选旋转方法，让C++使用本地几何中心
                    (shareData.tgfxBaseView as any).rotateSelectedLayer(deltaAngle, Number.NaN, Number.NaN);
                }
                
                // 标记需要重绘
                shareData.tgfxBaseView?.markDirty();
            } else {
                console.log(`[旋转JS] 无角度变化，跳过旋转`);
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
                // ========== 多选模式：使用缓存的世界坐标 ==========
                const oppositeCorner = scaleStateManager.getCachedCenter();
                if (!oppositeCorner) {
                    console.error('[缩放JS-多选] 无法获取对角点世界坐标');
                    return;
                }
                oppositeCenterX = oppositeCorner.x;
                oppositeCenterY = oppositeCorner.y;
                
                // 多选模式使用简化的缩放计算（不支持翻转）
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
            
            if (Math.abs(scaleFactors.scaleX - 1.0) > 0.0001 || Math.abs(scaleFactors.scaleY - 1.0) > 0.0001) { // 只有缩放变化超过阈值才执行
                if (isMultiSelection) {
                    console.log(`[缩放JS-多选] 应用缩放：scaleX=${scaleFactors.scaleX.toFixed(4)}, scaleY=${scaleFactors.scaleY.toFixed(4)}`);
                    // 多选模式：调用多选缩放方法，使用世界坐标作为枢轴
                    (shareData.tgfxBaseView as any).scaleMultiSelection(
                        scaleFactors.scaleX, scaleFactors.scaleY, oppositeCenterX, oppositeCenterY
                    );
                } else {
                    const localCorner = scaleStateManager.getOppositeCornerLocal()!;
                    console.log(`[缩放JS-单选] 应用缩放：scaleX=${scaleFactors.scaleX.toFixed(4)}, scaleY=${scaleFactors.scaleY.toFixed(4)}，枢轴本地坐标：(${localCorner.x.toFixed(2)}, ${localCorner.y.toFixed(2)})`);
                    // 单选模式：调用单选缩放方法，使用本地坐标作为枢轴
                    (shareData.tgfxBaseView as any).scaleSelectedLayerWithLocalPivot(
                        scaleFactors.scaleX, scaleFactors.scaleY, localCorner.x, localCorner.y
                    );
                }
                
                // 标记需要重绘
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

        // 鼠标悬停时的高亮和光标更新
        const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);
        const reDraw = shareData.tgfxBaseView?.highlightLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
        if (reDraw) {
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
        }

        const cursorType = cursorDetectionCache.detectCursorType(clientXY.clientX, clientXY.clientY, shareData);
        setCursor(canvas, cursorType, shareData);
    }

    public onMouseLeave(event: MouseEvent, canvas: HTMLElement, shareData: ShareData) {
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
                if (cornerInfo && cornerInfo.distance < 8) { // 确保在角控制器上
                    console.log(`[缩放] 开始缩放操作，检测到的角位置：${cornerInfo.position}`);
                    
                    // 获取检测到位置的索引（这就是用户看到的位置）
                    const cornerIndexMap: { [key: string]: number } = {
                        '左上角': 0, '右上角': 1, '右下角': 2, '左下角': 3
                    };
                    const detectedIdx = cornerIndexMap[cornerInfo.position] ?? -1;
                    
                    // 检测是否处于多选模式
                    const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                             (shareData.tgfxBaseView as any).isInMultiSelectionMode();
                    
                    if (isMultiSelection) {
                        // ========== 多选模式的缩放逻辑 ==========
                        console.log(`[缩放-多选] 多选模式，使用AABB对角点`);
                        
                        // 多选模式：使用AABB的对角点作为固定点
                        const oppositeCornerIdx = (detectedIdx + 2) % 4;
                        
                        // 获取所有角的坐标（AABB的4个角）
                        const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
                        if (cornersVector && typeof cornersVector.size === 'function' && cornersVector.size() >= 8) {
                            const oppositeCenterX = cornersVector.get(oppositeCornerIdx * 2);
                            const oppositeCenterY = cornersVector.get(oppositeCornerIdx * 2 + 1);
                            
                            console.log(`[缩放-多选] 操作角索引${detectedIdx}，固定对角点索引${oppositeCornerIdx}，世界坐标：(${oppositeCenterX.toFixed(1)}, ${oppositeCenterY.toFixed(1)})`);
                            
                            // 取消高亮
                            shareData.tgfxBaseView?.resetHighlightLayer();
                            
                            // 开始缩放状态，传入世界坐标（多选模式下不需要本地坐标）
                            scaleStateManager.startScaling(
                                worldCoords.worldX, worldCoords.worldY, 
                                oppositeCenterX, oppositeCenterY, 
                                detectedIdx, 
                                0, 0,  // 多选模式不使用本地坐标
                                true   // isMultiSelection = true
                            );
                            
                            isMouseDown = true;
                            hasMoved = false;
                            lastPointX = clientXY.clientX;
                            lastPointY = clientXY.clientY;
                            return;
                        }
                    } else {
                        // ========== 单选模式的缩放逻辑 ==========
                        // 获取这个位置在原始坐标系中的实际角名称和索引
                        // 用于翻转判断（左侧/右侧、上侧/下侧）
                        const actualCornerName = (shareData.tgfxBaseView as any).getCornerNameByPosition(detectedIdx);
                        const actualCornerIdx = cornerIndexMap[actualCornerName] ?? detectedIdx;
                        
                        console.log(`[缩放-单选] 检测角索引${detectedIdx}(${cornerInfo.position}) -> 原始角索引${actualCornerIdx}(${actualCornerName})`);
                        
                        // 使用检测到的索引计算对角点（视觉上的对角）
                        const oppositeCornerIdx = (detectedIdx + 2) % 4;
                        const localCornerVector = (shareData.tgfxBaseView as any).getSelectedLayerLocalCorner(oppositeCornerIdx);
                        
                        if (localCornerVector && typeof localCornerVector.size === 'function' && localCornerVector.size() >= 2) {
                            const localX = localCornerVector.get(0);
                            const localY = localCornerVector.get(1);
                            
                            // 将本地坐标转换为世界坐标（初始位置）
                            const worldCornerVector = (shareData.tgfxBaseView as any).localToWorldCoords(localX, localY);
                            if (worldCornerVector && typeof worldCornerVector.size === 'function' && worldCornerVector.size() >= 2) {
                                const oppositeCenterX = worldCornerVector.get(0);
                                const oppositeCenterY = worldCornerVector.get(1);
                                
                                console.log(`[缩放-单选] 操作角索引${detectedIdx}，固定对角点索引${oppositeCornerIdx}，本地坐标：(${localX.toFixed(2)}, ${localY.toFixed(2)})，世界坐标：(${oppositeCenterX.toFixed(1)}, ${oppositeCenterY.toFixed(1)})`);
                            
                                // 取消高亮
                                shareData.tgfxBaseView?.resetHighlightLayer();
                                
                                // 传入检测到的索引（用户看到的视觉位置），用于翻转判断
                                // 因为翻转判断应该基于用户的视觉感受：点击视觉左上角，鼠标往右下移动不应该翻转
                                scaleStateManager.startScaling(worldCoords.worldX, worldCoords.worldY, oppositeCenterX, oppositeCenterY, detectedIdx, localX, localY, false);
                                
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
            
            // 检测旋转操作 - 只有当光标是旋转类型时才进入旋转模式
            if (cursorType === 'rotate') {
                console.log('[旋转] 开始旋转操作');
                
                // 检测是否处于多选模式
                const isMultiSelection = (shareData.tgfxBaseView as any).isInMultiSelectionMode && 
                                         (shareData.tgfxBaseView as any).isInMultiSelectionMode();
                
                if (isMultiSelection) {
                    // ========== 多选模式的旋转逻辑 ==========
                    console.log(`[旋转-多选] 多选模式，使用AABB中心点`);
                    
                    // 多选模式：使用AABB的中心点作为旋转中心
                    const centerVector = (shareData.tgfxBaseView as any).getSelectedLayerCenter();
                    if (centerVector && typeof centerVector.size === 'function' && centerVector.size() >= 2) {
                        const centerX = centerVector.get(0);
                        const centerY = centerVector.get(1);
                        
                        console.log(`[旋转-多选] AABB中心点：(${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
                        
                        // 取消高亮
                        shareData.tgfxBaseView?.resetHighlightLayer();
                        
                        // 开始旋转，使用特殊的ID标识多选模式
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
                    // ========== 单选模式的旋转逻辑 ==========
                    // 获取选中图层信息和指针地址作为唯一标识\n     
                    const layerInfo = (shareData.tgfxBaseView as any).getSelectedLayerInfo();
                    let layerId = ''; // 图层唯一标识符
                    if (layerInfo && layerInfo.size && layerInfo.size() >= 3) {
                        const layerName = layerInfo.get(0);
                        const layerType = layerInfo.get(1);
                        layerId = layerInfo.get(2); // 获取图层指针地址作为ID
                        console.log(`[旋转-单选] 选中图层：${layerName} (${layerType}), ID: ${layerId}`);
                    }
                    
                    // 获取并缓存中心点
                    const centerVector = (shareData.tgfxBaseView as any).getSelectedLayerCenter();
                    if (centerVector && typeof centerVector.size === 'function' && centerVector.size() >= 2) {
                        const centerX = centerVector.get(0);
                        const centerY = centerVector.get(1);
                        
                        // 取消高亮
                        shareData.tgfxBaseView?.resetHighlightLayer();
                        
                        // 转换为世界坐标并开始旋转，传递图层ID
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
                console.log('[鼠标按下] 选中图层，不启动框选');
            } else {
                // 未选中图层，点击空白区域，准备框选
                console.log('[鼠标按下] 点击空白区域，准备框选');
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
                // 输出缩放结束时的详细信息
                const cornerIdx = scaleStateManager.getCornerIndex();
                const cachedCenter = scaleStateManager.getCachedCenter();
                
                // 获取当前4个角的坐标
                const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
                if (cornersVector && typeof cornersVector.size === 'function' && cornersVector.size() >= 8) {
                    const corners: number[] = [];
                    for (let i = 0; i < 8; i++) {
                        corners.push(cornersVector.get(i));
                    }
                    
                    // 使用基于坐标位置的角名称判断
                    const actualCornerName = shareData.tgfxBaseView?.getCornerNameByPosition(cornerIdx) || '未知角';
                    const currentCornerX = corners[cornerIdx * 2];
                    const currentCornerY = corners[cornerIdx * 2 + 1];
                    
                    // 缩放结束信息已简化
                }
                
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
                console.log('[旋转] 结束旋转操作');
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
            
            // ⚠️ 关键修复：无论是否框选，都要重置框选管理器状态
            // 避免isPrepared状态残留导致下次点击误触发框选
            boxSelectionManager.reset();

            if (!hasMoved) {
                // 单击事件：调用选中方法
                const clientXY = ConvertCoordinates(event, canvas);
                const worldCoords = CoordinateTransformer.screenToWorld(clientXY.clientX, clientXY.clientY, shareData);

                console.log(`[JS调试] 单击坐标：(${worldCoords.worldX}, ${worldCoords.worldY})`);
                const selected = shareData.tgfxBaseView?.selectLayerAndCheckRedraw(worldCoords.worldX, worldCoords.worldY);
                console.log(`[JS调试] 选中结果：${selected}`);
            } else {
                shareData.tgfxBaseView?.resetMoveLayers();
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