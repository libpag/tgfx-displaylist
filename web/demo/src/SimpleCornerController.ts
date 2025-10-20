/**
 * 简化的角控制器处理
 * 只处理等比缩放显示、角控制器检测和光标显示功能
 */

import {TGFXBaseView, shareData} from '../common';

/**
 * 简单的角控制器管理
 */
export class SimpleCornerController {
  private view: TGFXBaseView;
  private selectedLayerBounds: {centerX: number, centerY: number, width: number, height: number} | null = null;

  constructor(view: TGFXBaseView) {
    this.view = view;
  }

  /**
   * 根据缩放更新角控制器大小（保持屏幕尺寸恒定）
   */
  updateForZoom(zoom: number): void {
    // 计算缩放因子以保持恒定的屏幕尺寸
    const scaleFactor = 1.0 / zoom;
    
    // 使用现有接口更新角控制器大小
    if (this.view.setHandleSizeFactor) {
      this.view.setHandleSizeFactor(scaleFactor);
    }
    
    if (this.view.updateCornerHandles) {
      this.view.updateCornerHandles();
    }
  }

  /**
   * 检测是否在角控制器上
   */
  isInCornerHandle(screenX: number, screenY: number): boolean {
    const zoom = shareData.zoom || 1.0;
    const offsetX = shareData.offsetX || 0;
    const offsetY = shareData.offsetY || 0;
    
    // 转换到世界坐标
    const worldX = (screenX - offsetX) / zoom;
    const worldY = (screenY - offsetY) / zoom;
    
    return this.view.isPointInCornerHandle && this.view.isPointInCornerHandle(worldX, worldY);
  }

  /**
   * 更新光标样式
   */
  updateCursorStyle(screenX: number, screenY: number, canvas: HTMLElement): void {
    const zoom = shareData.zoom || 1.0;
    const offsetX = shareData.offsetX || 0;
    const offsetY = shareData.offsetY || 0;
    
    // 转换到世界坐标
    const worldX = (screenX - offsetX) / zoom;
    const worldY = (screenY - offsetY) / zoom;

    try {
      // 优先检查是否在角控制器上
      const isOnCornerHandle = this.view.isPointInCornerHandle && this.view.isPointInCornerHandle(worldX, worldY);
      
      if (isOnCornerHandle) {
        // 当检测到角控制器时，设置图层边界信息
        this.setLayerBoundsFromCornerDetection(worldX, worldY);
        
        // 获取角控制器的具体位置来确定光标方向
        const cornerPosition = this.getCornerHandlePosition(worldX, worldY, canvas);
        canvas.style.cursor = this.getCornerCursor(cornerPosition);
        return;
      }
      
      // 检查旋转区域
      const isInRotationArea = this.isPointInRotationArea(worldX, worldY);
      
      if (isInRotationArea) {
        canvas.style.cursor = this.getRotationCursor();
        return;
      }
      
      // 默认光标
      canvas.style.cursor = 'default';
    } catch (error) {
      canvas.style.cursor = 'default';
    }
  }

  /**
   * 获取角控制器位置
   */
  private getCornerHandlePosition(worldX: number, worldY: number, canvas: HTMLElement): string {
    try {
      const rect = canvas.getBoundingClientRect();
      const screenCenterX = rect.width / 2;
      const screenCenterY = rect.height / 2;
      
      // 将世界坐标转换为屏幕坐标来判断
      const screenX = worldX * shareData.zoom + shareData.offsetX;
      const screenY = worldY * shareData.zoom + shareData.offsetY;
      
      const isLeft = screenX < screenCenterX;
      const isTop = screenY < screenCenterY;
      
      if (isLeft && isTop) {
        return 'nw'; // 左上角
      } else if (!isLeft && isTop) {
        return 'ne'; // 右上角
      } else if (isLeft && !isTop) {
        return 'sw'; // 左下角
      } else {
        return 'se'; // 右下角
      }
    } catch (error) {
      return 'nw'; // 默认左上角
    }
  }

  /**
   * 根据角位置获取对应的光标
   */
  private getCornerCursor(position: string): string {
    const svgCursors = {
      // 左上角：从左上角指向右下角
      'nw': 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'%23000\' stroke=\'%23fff\' stroke-width=\'1\'%3E%3Cpath d=\'M4 4l4 0 0 2 -2 0 0 2 -2 0z\'/%3E%3Cpath d=\'M20 20l-4 0 0 -2 2 0 0 -2 2 0z\'/%3E%3Cline x1=\'4\' y1=\'4\' x2=\'20\' y2=\'20\' stroke=\'%23000\' stroke-width=\'2\'/%3E%3C/g%3E%3C/svg%3E") 12 12, nw-resize',
      
      // 右上角：从右上角指向左下角
      'ne': 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'%23000\' stroke=\'%23fff\' stroke-width=\'1\'%3E%3Cpath d=\'M20 4l-4 0 0 2 2 0 0 2 2 0z\'/%3E%3Cpath d=\'M4 20l4 0 0 -2 -2 0 0 -2 -2 0z\'/%3E%3Cline x1=\'20\' y1=\'4\' x2=\'4\' y2=\'20\' stroke=\'%23000\' stroke-width=\'2\'/%3E%3C/g%3E%3C/svg%3E") 12 12, ne-resize',
      
      // 左下角：从左下角指向右上角
      'sw': 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'%23000\' stroke=\'%23fff\' stroke-width=\'1\'%3E%3Cpath d=\'M4 20l4 0 0 -2 -2 0 0 -2 -2 0z\'/%3E%3Cpath d=\'M20 4l-4 0 0 2 2 0 0 2 2 0z\'/%3E%3Cline x1=\'4\' y1=\'20\' x2=\'20\' y2=\'4\' stroke=\'%23000\' stroke-width=\'2\'/%3E%3C/g%3E%3C/svg%3E") 12 12, sw-resize',
      
      // 右下角：从右下角指向左上角
      'se': 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'%23000\' stroke=\'%23fff\' stroke-width=\'1\'%3E%3Cpath d=\'M20 20l-4 0 0 -2 2 0 0 -2 2 0z\'/%3E%3Cpath d=\'M4 4l4 0 0 2 -2 0 0 2 -2 0z\'/%3E%3Cline x1=\'20\' y1=\'20\' x2=\'4\' y2=\'4\' stroke=\'%23000\' stroke-width=\'2\'/%3E%3C/g%3E%3C/svg%3E") 12 12, se-resize'
    };
    
    return svgCursors[position] || svgCursors['nw'];
  }

  /**
   * 获取旋转光标
   */
  private getRotationCursor(): string {
    return 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cg fill=\'none\' stroke=\'%23000\' stroke-width=\'2\' stroke-linecap=\'round\'%3E%3Cpath d=\'M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.12 0 4.07 0.74 5.6 1.98\'/%3E%3Cpath d=\'M16 8l2-2 2 2\'/%3E%3Cpath d=\'M18 6v4h-4\'/%3E%3C/g%3E%3C/svg%3E") 12 12, alias';
  }

  /**
   * 检查是否在旋转区域
   */
  private isPointInRotationArea(worldX: number, worldY: number): boolean {
    try {
      // 如果没有选中图层的边界信息，返回false
      if (!this.selectedLayerBounds) {
        return false;
      }
      
      const {centerX, centerY, width, height} = this.selectedLayerBounds;
      const left = centerX - width / 2;
      const right = centerX + width / 2;
      const top = centerY - height / 2;
      const bottom = centerY + height / 2;
      
      // 检查是否在角控制器上，如果是则不显示旋转光标
      const isOnCornerHandle = this.view.isPointInCornerHandle && this.view.isPointInCornerHandle(worldX, worldY);
      if (isOnCornerHandle) {
        return false;
      }
      
      // 根据缩放级别调整区域大小
      const cornerHandleSize = 8 / shareData.zoom;
      const rotationAreaSize = 25 / shareData.zoom;
      
      // 定义四个角控制器的位置
      const corners = [
        {x: left, y: top},
        {x: right, y: top},
        {x: left, y: bottom},
        {x: right, y: bottom}
      ];
      
      // 检查是否在任何角控制器的外侧旋转区域内
      for (const corner of corners) {
        const distanceToCorner = Math.sqrt(
          Math.pow(worldX - corner.x, 2) + Math.pow(worldY - corner.y, 2)
        );
        
        // 如果在旋转区域内但不在角控制器内
        if (distanceToCorner <= rotationAreaSize && distanceToCorner > cornerHandleSize) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 当检测到角控制器时，动态设置边界信息
   */
  private setLayerBoundsFromCornerDetection(worldX: number, worldY: number): void {
    try {
      // 估算图层大小
      const estimatedWidth = 120 / shareData.zoom;
      const estimatedHeight = 120 / shareData.zoom;
      
      // 基于当前鼠标位置估算图层中心
      let centerX = worldX;
      let centerY = worldY;
      
      // 根据角控制器位置调整中心点估算
      const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
      if (canvas) {
        const screenX = worldX * shareData.zoom + shareData.offsetX;
        const screenY = worldY * shareData.zoom + shareData.offsetY;
        const rect = canvas.getBoundingClientRect();
        const screenCenterX = rect.width / 2;
        const screenCenterY = rect.height / 2;
        
        const isLeft = screenX < screenCenterX;
        const isTop = screenY < screenCenterY;
        
        // 根据角位置调整中心点
        if (isLeft && isTop) {
          centerX = worldX + estimatedWidth / 2;
          centerY = worldY + estimatedHeight / 2;
        } else if (!isLeft && isTop) {
          centerX = worldX - estimatedWidth / 2;
          centerY = worldY + estimatedHeight / 2;
        } else if (isLeft && !isTop) {
          centerX = worldX + estimatedWidth / 2;
          centerY = worldY - estimatedHeight / 2;
        } else {
          centerX = worldX - estimatedWidth / 2;
          centerY = worldY - estimatedHeight / 2;
        }
      }
      
      this.selectedLayerBounds = {
        centerX,
        centerY,
        width: estimatedWidth,
        height: estimatedHeight
      };
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 处理鼠标移动事件
   */
  handleMouseMove(event: MouseEvent, canvas: HTMLElement): void {
    const rect = canvas.getBoundingClientRect();
    const screenX = (event.clientX - rect.left) * window.devicePixelRatio;
    const screenY = (event.clientY - rect.top) * window.devicePixelRatio;

    // 更新缩放适应
    this.updateForZoom(shareData.zoom || 1.0);

    // 更新光标样式
    this.updateCursorStyle(screenX, screenY, canvas);

    // 调用原有的鼠标移动处理
    if (this.view.onMouseMove) {
      this.view.onMouseMove(screenX, screenY);
    }
  }
}