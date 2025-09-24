#pragma once

#include <memory>
#include "tgfx/core/Matrix.h"
#include "tgfx/core/Point.h"
#include "tgfx/layers/Layer.h"

/**
 * 坐标转换工具类
 * 处理屏幕坐标、视图坐标、图层本地坐标之间的转换
 */
class CoordinateTransformer {
 public:
  /**
     * 计算图层到根图层的全局变换矩阵（用于高亮定位）
     */
  static tgfx::Matrix getLayerToRootMatrix(std::shared_ptr<tgfx::Layer> layer);

  /**
     * 将屏幕坐标增量转换为图层本地坐标增量（用于拖动）
     */
  static tgfx::Point screenDeltaToLayerDelta(float screenDeltaX, float screenDeltaY, float zoom,
                                             std::shared_ptr<tgfx::Layer> layer);

  /**
     * 将屏幕坐标转换为图层本地坐标（用于点击检测）
     */
  static tgfx::Point screenToLayerLocal(float screenX, float screenY, float zoom,
                                        std::shared_ptr<tgfx::Layer> layer);

 private:
  /**
     * 通过采样关键点计算变换矩阵
     */
  static tgfx::Matrix calculateTransformMatrix(std::shared_ptr<tgfx::Layer> layer);
};