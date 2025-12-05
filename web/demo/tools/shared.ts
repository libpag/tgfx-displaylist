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
 * 交互常量配置
 */
export const InteractionConfig = {
    // 缩放限制
    MIN_ZOOM: 0.01,
    MAX_ZOOM: 1000.0,
    
    // 命中检测阈值（屏幕像素空间）
    CORNER_HIT_TOLERANCE_PIXELS: 30,      // 角控制器命中容差（屏幕像素）
    ROTATION_ZONE_TOLERANCE_PIXELS: 80,   // 旋转区域最大距离（屏幕像素）
    
    // 框选相关
    BOX_SELECTION_MIN_DRAG: 20,           // 框选最小拖动距离（像素）
    BOX_SELECTION_MIN_PRESS: 300,         // 框选最小按压时间（毫秒）
    
    // 缩放变化阈值
    SCALE_CHANGE_THRESHOLD: 0.0001,       // 缩放变化检测阈值
    
    // 手势检测
    PINCH_TIMEOUT: 150,                   // 捏合超时（毫秒）
    TIME_THRESHOLD: 50,                   // 时间阈值（毫秒）
    DELTA_Y_THRESHOLD: 50,                // deltaY阈值
    DELTA_Y_CHANGE_THRESHOLD: 10,         // deltaY变化阈值
    MOUSE_WHEEL_RATIO: 800,               // 鼠标滚轮比率
    TOUCH_WHEEL_RATIO: 100,               // 触摸板滚轮比率
    
    // 旋转相关
    MIN_ROTATION_RADIUS_FACTOR: 0.25,     // 最小旋转半径因子
    MIN_ABSOLUTE_RADIUS: 1e-3,            // 最小绝对半径
};

/**
 * 坐标转换器类 - 统一处理坐标转换逻辑
 */
export class CoordinateTransformer {
    static screenToWorld(screenX: number, screenY: number, shareData: ShareData): { worldX: number; worldY: number } {
        const safeZoom = Math.max(shareData.zoom, InteractionConfig.MIN_ZOOM);
        const worldX = (screenX - shareData.offsetX) / safeZoom;
        const worldY = (screenY - shareData.offsetY) / safeZoom;
        return { worldX, worldY };
    }

    static worldToScreen(worldX: number, worldY: number, shareData: ShareData): { screenX: number; screenY: number } {
        const screenX = worldX * shareData.zoom + shareData.offsetX;
        const screenY = worldY * shareData.zoom + shareData.offsetY;
        return { screenX, screenY };
    }
}

/**
 * 光标工厂类 - 负责创建和缓存光标
 */
export class CursorFactory {
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
        const baseAngles: { [key: string]: number } = {
            'nw-resize': 180,
            'ne-resize': -90,
            'se-resize': 0,
            'sw-resize': 90
        };

        const baseAngle = baseAngles[direction] || 0;
        const totalAngle = baseAngle + rotationAngle;

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

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        // 上半部分弧形箭头
        ctx.beginPath();
        ctx.arc(12, 12, 9, -Math.PI / 2, 0, false);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(18, 9);
        ctx.lineTo(21, 12);
        ctx.lineTo(18, 15);
        ctx.stroke();

        // 下半部分弧形箭头
        ctx.beginPath();
        ctx.arc(12, 12, 9, Math.PI / 2, Math.PI, false);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(6, 15);
        ctx.lineTo(3, 12);
        ctx.lineTo(6, 9);
        ctx.stroke();

        const dataUrl = canvas.toDataURL('image/png');
        return `url('${dataUrl}') 12 12, auto`;
    }

    getCursor(type: string, rotationAngle: number = 0): string {
        const cacheKey = rotationAngle !== 0 ? `${type}_${rotationAngle.toFixed(2)}` : type;
        
        if (this.cursorCache.has(cacheKey)) {
            return this.cursorCache.get(cacheKey)!;
        }

        let cursor: string;
        if (type === 'rotate') {
            cursor = this.createRotateCursor();
        } else if (['nw-resize', 'ne-resize', 'sw-resize', 'se-resize'].includes(type)) {
            const rotationDegrees = rotationAngle * 180 / Math.PI;
            cursor = this.createArrowCursor(type, rotationDegrees);
        } else {
            cursor = type;
        }

        this.cursorCache.set(cacheKey, cursor);
        return cursor;
    }

    clearCache(): void {
        this.cursorCache.clear();
    }
}

/**
 * 角检测结果
 */
export interface CornerDetectionResult {
    position: string;           // 视觉位置名称（左上角、右上角等）
    distance: number;           // 归一化距离
    localCornerIndex: number;   // 本地角索引
    screenPixelDistance: number; // 屏幕像素距离
}

/**
 * 角检测工具类
 */
export class CornerDetector {
    /**
     * 检测最近的角
     */
    static detectCorner(
        screenX: number, 
        screenY: number, 
        shareData: ShareData
    ): CornerDetectionResult | null {
        if (!shareData.tgfxBaseView) {
            return null;
        }

        try {
            // 获取选中图层的4个角位置
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
            
            // 获取鼠标的世界坐标
            const worldCoords = CoordinateTransformer.screenToWorld(screenX, screenY, shareData);
            
            // 找最近的角
            let minScreenDistance = Infinity;
            let nearestCornerIdx = -1;
            
            for (const c of corners) {
                const dx = worldCoords.worldX - c.x;
                const dy = worldCoords.worldY - c.y;
                const worldDist = Math.sqrt(dx * dx + dy * dy);
                const screenDist = worldDist * shareData.zoom;
                
                if (screenDist < minScreenDistance) {
                    minScreenDistance = screenDist;
                    nearestCornerIdx = c.idx;
                }
            }

            // 检查是否在最大检测范围内
            if (minScreenDistance > InteractionConfig.ROTATION_ZONE_TOLERANCE_PIXELS) {
                return null;
            }

            // 计算视觉位置
            const visualPosition = this.localCornerToVisualPosition(nearestCornerIdx, corners);

            // 计算归一化距离
            const diagonalLength = Math.hypot(
                corners[2].x - corners[0].x,
                corners[2].y - corners[0].y
            );
            const normalizedDistance = diagonalLength > 0 
                ? (minScreenDistance / shareData.zoom) / diagonalLength 
                : 0;

            return {
                position: visualPosition,
                distance: normalizedDistance,
                localCornerIndex: nearestCornerIdx,
                screenPixelDistance: minScreenDistance
            };

        } catch (error) {
            console.error('[CornerDetector] 检测失败:', error);
            return null;
        }
    }

    /**
     * 将本地角索引转换为视觉位置名称
     */
    private static localCornerToVisualPosition(
        localCornerIndex: number, 
        corners: { x: number; y: number; idx: number }[]
    ): string {
        // 按 X 坐标排序，找出左侧和右侧的角
        const sortedByX = [...corners].sort((a, b) => a.x - b.x);
        const leftCorners = [sortedByX[0], sortedByX[1]];
        const rightCorners = [sortedByX[2], sortedByX[3]];
        
        const isLeft = leftCorners.some(c => c.idx === localCornerIndex);
        
        if (isLeft) {
            const leftSorted = leftCorners.sort((a, b) => a.y - b.y);
            const isTop = leftSorted[0].idx === localCornerIndex;
            return isTop ? '左上角' : '左下角';
        } else {
            const rightSorted = rightCorners.sort((a, b) => a.y - b.y);
            const isTop = rightSorted[0].idx === localCornerIndex;
            return isTop ? '右上角' : '右下角';
        }
    }
}

/**
 * 多边形内点检测工具
 */
export class PolygonUtils {
    /**
     * 射线法检测点是否在多边形内部
     */
    static isPointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
        let inside = false;
        const n = polygon.length;
        
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }

    /**
     * 检查点是否在选中图层内部
     */
    static isPointInSelectedLayer(worldX: number, worldY: number, shareData: ShareData): boolean {
        if (!shareData.tgfxBaseView) return false;

        try {
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                return false;
            }

            const corners: { x: number; y: number }[] = [];
            for (let i = 0; i < 4; i++) {
                corners.push({
                    x: cornersVector.get(i * 2),
                    y: cornersVector.get(i * 2 + 1)
                });
            }

            return this.isPointInPolygon(worldX, worldY, corners);
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查点是否在多选包围盒内部
     */
    static isPointInMultiSelectionBounds(worldX: number, worldY: number, shareData: ShareData): boolean {
        if (!shareData.tgfxBaseView) return false;

        try {
            const cornersVector = (shareData.tgfxBaseView as any).getSelectedLayerCorners();
            if (!cornersVector || typeof cornersVector.size !== 'function' || cornersVector.size() < 8) {
                return false;
            }

            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            
            for (let i = 0; i < 4; i++) {
                const x = cornersVector.get(i * 2);
                const y = cornersVector.get(i * 2 + 1);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }

            return worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY;
        } catch (error) {
            return false;
        }
    }
}
