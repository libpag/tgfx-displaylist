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
#include "TGFXBaseView.h"
#include <cmath>
#include "hello2d/LayerBuilder.h"
#include "tgfx/core/Point.h"
#include "tgfx/layers/ImageLayer.h"
#include "tgfx/layers/TextLayer.h"

using namespace emscripten;

namespace displaylist {

// 默认高亮线宽为 5.0f
float TGFXBaseView::s_highlightLineWidth = 5.0f;

TGFXBaseView::TGFXBaseView(const std::string& canvasID) : canvasID(canvasID) {
  appHost = std::make_shared<hello2d::AppHost>();
  lastDrawIndex = -1;
  lastZoom = 0;
  lastOffsetX = 0;
  lastOffsetY = 0;
}

bool TGFXBaseView::updateSize(float devicePixelRatio) {
  if (canvasID.empty()) return false;

  // 等待当前渲染任务完成
  if (window) {
    auto device = window->getDevice();
    if (device) {
      auto context = device->lockContext();
      if (context) {
        context->flushAndSubmit();
        device->unlock();
      }
    }
  }

  int width = 0;
  int height = 0;
  emscripten_get_canvas_element_size(canvasID.c_str(), &width, &height);

  width = std::max(1, width);
  height = std::max(1, height);

  auto sizeChanged = appHost->updateScreen(width, height, devicePixelRatio);

  if (sizeChanged) {
    window = nullptr;
    appHost->markDirty();
  }
  resetHighlightLayer();
  return sizeChanged;
}

void TGFXBaseView::setImage(const std::string& name, tgfx::NativeImageRef nativeImage) {
  auto image = tgfx::Image::MakeFrom(nativeImage);
  if (image) {
    appHost->addImage(name, image);
  }
}

bool TGFXBaseView::draw(int drawIndex, float zoom, float offsetX, float offsetY) {
  lastDrawIndex = drawIndex;
  lastZoom = zoom;
  lastOffsetX = offsetX;
  lastOffsetY = offsetY;

  if (!appHost->isDirty()) {
    return false;
  }

  appHost->resetDirty();

  if (appHost->width() <= 0 || appHost->height() <= 0) {
    return true;
  }

  if (window == nullptr) {
    window = tgfx::WebGLWindow::MakeFrom(canvasID);
    if (window == nullptr) {
      return true;
    }
  }

  auto device = window->getDevice();
  if (!device) {
    window = nullptr;
    return true;
  }

  auto context = device->lockContext();
  if (!context) {
    window = nullptr;
    return true;
  }

  auto surface = window->getSurface(context);
  if (surface == nullptr) {
    device->unlock();
    return true;
  }

  appHost->updateZoomAndOffset(zoom, tgfx::Point(offsetX, offsetY));

  // 实时更新高亮线宽以保持视觉一致性
  updateHighlightLineWidth();

  auto canvas = surface->getCanvas();
  if (canvas == nullptr) {
    device->unlock();
    return true;
  }
  canvas->clear();

  reapplyRenderSettings();

  auto numhello2d = hello2d::LayerBuilder::Count();
  auto index = (drawIndex % numhello2d);
  bool isNeedBackground = false;
  appHost->draw(canvas, index, isNeedBackground);
  context->flushAndSubmit();
  window->present(context);
  device->unlock();

  return true;
}

void TGFXBaseView::setAllowBlur(bool allowBlur) {
  currentAllowBlur = allowBlur;
  appHost->displayList.setAllowZoomBlur(allowBlur);
  appHost->markDirty();
}

void TGFXBaseView::setShowDirtyRect(bool isVisible) {
  currentShowDirtyRect = isVisible;
  appHost->displayList.showDirtyRegions(isVisible);
  appHost->markDirty();
}

void TGFXBaseView::setRenderMode(int mode) {
  currentRenderMode = mode;
  appHost->displayList.setRenderMode(static_cast<tgfx::RenderMode>(mode));
  appHost->markDirty();
}

void TGFXBaseView::setTileSize(int size) {
  currentTileSize = size;
  appHost->displayList.setTileSize(size);
  appHost->markDirty();
}

void TGFXBaseView::setMaxTileCount(int count) {
  currentMaxTileCount = count;
  appHost->displayList.setMaxTileCount(count);
  appHost->markDirty();
}
std::vector<std::string> TGFXBaseView::getDrawerNames() {
  auto names = hello2d::LayerBuilder::Names();
  return names;
}

bool TGFXBaseView::highlightLayerAndCheckRedraw(float x, float y) {
  if (!appHost) {
    return false;
  }

  auto layers = appHost->getLayersUnderPoint(x, y);

  if (layers.size() > 0) {
    auto layer = layers[0];

    // 调试信息：打印所有找到的图层
    printf("=== Found %zu layers at point (%.1f, %.1f) ===\n", layers.size(), x, y);
    for (size_t i = 0; i < layers.size(); i++) {
      auto layerType = layers[i]->type();
      const char* typeName = "Unknown";
      switch (layerType) {
        case tgfx::LayerType::Image:
          typeName = "Image";
          break;
        case tgfx::LayerType::Text:
          typeName = "Text";
          break;
        case tgfx::LayerType::Shape:
          typeName = "Shape";
          break;
        case tgfx::LayerType::Solid:
          typeName = "Solid";
          break;
        case tgfx::LayerType::Layer:
          typeName = "Layer";
          break;
      }
      printf("  [%zu] Type: %s\n", i, typeName);
    }

    // 优先选择真正的内容图层，使用分级选择策略
    std::shared_ptr<tgfx::Layer> selectedLayer = nullptr;

    // 第一优先级：Image 和 Text（真正的内容层）
    for (auto it : layers) {
      auto layerType = it->type();
      if (layerType == tgfx::LayerType::Image || layerType == tgfx::LayerType::Text) {
        selectedLayer = it;
        printf(">>> Selected HIGH-PRIORITY layer type: %s\n",
               layerType == tgfx::LayerType::Image ? "Image" : "Text");
        break;
      }
    }

    // 第二优先级：检查 Shape 层是否是遮罩层，如果是则选择被遮罩的层
    if (!selectedLayer) {
      for (auto it : layers) {
        auto layerType = it->type();
        if (layerType == tgfx::LayerType::Shape || layerType == tgfx::LayerType::Solid) {
          // 检查这个 Shape 层是否是某个层的遮罩
          std::shared_ptr<tgfx::Layer> maskedLayer = nullptr;

          // 遍历所有层，找到使用当前 Shape 作为遮罩的层
          for (auto checkLayer : layers) {
            if (checkLayer->mask() == it) {
              maskedLayer = checkLayer;
              printf(">>> Found masked layer! Shape is mask for layer type: %s\n",
                     checkLayer->type() == tgfx::LayerType::Image   ? "Image"
                     : checkLayer->type() == tgfx::LayerType::Text  ? "Text"
                     : checkLayer->type() == tgfx::LayerType::Shape ? "Shape"
                     : checkLayer->type() == tgfx::LayerType::Solid ? "Solid"
                     : checkLayer->type() == tgfx::LayerType::Layer ? "Layer"
                                                                    : "Unknown");
              break;
            }
          }

          // 如果找到了被遮罩的层，优先选择被遮罩的层
          if (maskedLayer) {
            selectedLayer = maskedLayer;
            printf(">>> Selected MASKED layer type: %s\n",
                   maskedLayer->type() == tgfx::LayerType::Image   ? "Image"
                   : maskedLayer->type() == tgfx::LayerType::Text  ? "Text"
                   : maskedLayer->type() == tgfx::LayerType::Shape ? "Shape"
                   : maskedLayer->type() == tgfx::LayerType::Solid ? "Solid"
                   : maskedLayer->type() == tgfx::LayerType::Layer ? "Layer"
                                                                   : "Unknown");
          } else {
            selectedLayer = it;
            printf(">>> Selected MEDIUM-PRIORITY layer type: %s\n",
                   layerType == tgfx::LayerType::Shape ? "Shape" : "Solid");
          }
          break;
        }
      }
    }

    // 最后选择：使用第一个层（通常是容器层）
    if (!selectedLayer) {
      selectedLayer = layers[0];
      printf(">>> Selected FALLBACK layer type: %s\n",
             selectedLayer->type() == tgfx::LayerType::Layer ? "Layer" : "Unknown");
    }

    layer = selectedLayer;
    printf("=== Final selected layer type: %s ===\n\n",
           layer->type() == tgfx::LayerType::Image   ? "Image"
           : layer->type() == tgfx::LayerType::Text  ? "Text"
           : layer->type() == tgfx::LayerType::Shape ? "Shape"
           : layer->type() == tgfx::LayerType::Solid ? "Solid"
           : layer->type() == tgfx::LayerType::Layer ? "Layer"
                                                     : "Unknown");

    // 如果没有找到有内容的图层，使用原来的遮罩逻辑
    auto selectedLayerType = layer->type();
    if (selectedLayerType == tgfx::LayerType::Layer) {
      for (auto it : layers) {
        if (it->mask() == layer) {
          layer = it;
          break;
        }
      }
    }

    // 验证鼠标是否真的在图层的内容边界内
    auto contentBounds = layer->getBounds(nullptr, true);
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
    auto globalContentBounds = globalMatrix.mapRect(contentBounds);

    if (!globalContentBounds.contains(x, y)) {
      // 鼠标不在内容边界内，移除现有高亮
      if (latestHighlightedLayer) {
        resetHighlightLayer();
      }
      return false;
    }

    if (layer == latestHighlightedLayer) {
      return false;
    }

    if (highLightLayerIndex >= 0) {
      if (latestHighlightedLayer &&
          highLightLayerIndex == latestHighlightedLayer->getChildIndex(layer)) {
        return false;
      }
    }
    if (latestHighlightedLayer) {
      resetHighlightLayer();
    }

    auto highlightLayer = tgfx::ShapeLayer::Make();
    highlightLayer->setBlendMode(tgfx::BlendMode::SrcOver);
    auto rectPath = tgfx::Path();
    rectPath.addRect(layer->getBounds(nullptr, true));
    highlightLayer->setPath(rectPath);

    highlightLayer->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41)));

    // 计算缩放比例，调整线宽以保持视觉一致性
    // 同时考虑全局缩放(lastZoom)和图层变换矩阵
    float scaleX = globalMatrix.getScaleX();
    float scaleY = globalMatrix.getScaleY();
    float layerAvgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;

    // 结合全局缩放和图层缩放计算最终的缩放比例
    float totalScale = layerAvgScale * lastZoom;
    float adjustedLineWidth =
        totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;

    highlightLayer->setLineWidth(adjustedLineWidth);
    highlightLayer->setStrokeAlign(tgfx::StrokeAlign::Outside);
    auto maskLayer = layer->mask();

    highlightLayer->setMatrix(globalMatrix);

    if (maskLayer != nullptr) {
      auto maskPath = tgfx::Path();
      maskPath.addRect(maskLayer->getBounds());
      highlightLayer->setPath(maskPath);
    }

    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      rootLayer->addChild(highlightLayer);
      highLightLayerIndex = rootLayer->getChildIndex(highlightLayer);
    } else {
      auto parentLayer = layer->parent();
      auto index = parentLayer->getChildIndex(layer);
      parentLayer->addChildAt(highlightLayer, index + 1);
      highLightLayerIndex = parentLayer->getChildIndex(highlightLayer);
    }
    latestHighlightedLayer = highlightLayer;

  } else {
    if (latestHighlightedLayer) {
      resetHighlightLayer();
    } else {
      return false;
    }
  }

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::resetHighlightLayer() {
  if (!latestHighlightedLayer) {
    return false;
  }

  if (!appHost) {
    return false;
  }

  if (highLightLayerIndex >= 0) {
    latestHighlightedLayer->removeFromParent();
    latestHighlightedLayer = nullptr;
    highLightLayerIndex = -1;
  }

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::resetMoveLayers() {
  if (moveLayers.empty()) {
    return false;
  }

  if (!appHost) {
    return false;
  }

  moveLayers.clear();

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::selectMoveLayer(float pointX, float pointY) {
  if (!appHost) {
    return false;
  }

  auto layers = appHost->getLayersUnderPoint(pointX, pointY);

  if (layers.size() < 1) {
    return false;
  }
  auto layer = layers[0];
  for (auto it : layers) {
    if (it->mask() == layer) {
      moveLayers.push_back(it);
    }
  }
  moveLayers.push_back(layer);
  return true;
}

void TGFXBaseView::moveHighlightLayer(float deltaX, float deltaY) {
  if (moveLayers.empty()) {
    return;
  }

  for (auto moveLayer : moveLayers) {
    auto localDelta =
        CoordinateTransformer::screenDeltaToLayerDelta(deltaX, deltaY, lastZoom, moveLayer);

    auto matrix = moveLayer->matrix();
    matrix.preTranslate(localDelta.x, localDelta.y);
    moveLayer->setMatrix(matrix);
  }

  appHost->markDirty();
}

std::vector<float> TGFXBaseView::getMoveLayerPosition() {
  std::vector<float> position = {0.0f, 0.0f};

  if (!moveLayers.empty()) {
    auto matrix = moveLayers.at(0)->matrix();
    position[0] = matrix.getTranslateX();
    position[1] = matrix.getTranslateY();
  }

  return position;
}

std::vector<float> TGFXBaseView::getMoveLayerGlobalMatrix() {
  std::vector<float> matrixInfo = {1.0f, 1.0f, 0.0f, 0.0f};

  if (!moveLayers.empty()) {
    auto moveLayer = moveLayers.at(0);
    auto origin = moveLayer->localToGlobal(tgfx::Point::Make(0, 0));
    auto unitX = moveLayer->localToGlobal(tgfx::Point::Make(1, 0));
    auto unitY = moveLayer->localToGlobal(tgfx::Point::Make(0, 1));

    float scaleX = unitX.x - origin.x;
    float scaleY = unitY.y - origin.y;

    matrixInfo[0] = scaleX;
    matrixInfo[1] = scaleY;
    matrixInfo[2] = origin.x;
    matrixInfo[3] = origin.y;
  }

  return matrixInfo;
}

void TGFXBaseView::markDirty() {
  if (appHost) {
    appHost->markDirty();
  }
}

void TGFXBaseView::onWheelEvent() {
  if (appHost) {
    // 实时更新高亮线宽以保持视觉一致性
    updateHighlightLineWidth();
    appHost->markDirty();
  }
}

void TGFXBaseView::reapplyRenderSettings() {
  if (!appHost) {
    return;
  }

  appHost->displayList.setRenderMode(static_cast<tgfx::RenderMode>(currentRenderMode));
  appHost->displayList.setAllowZoomBlur(currentAllowBlur);
  appHost->displayList.showDirtyRegions(currentShowDirtyRect);
  appHost->displayList.setTileSize(currentTileSize);
  appHost->displayList.setMaxTileCount(currentMaxTileCount);
}

void TGFXBaseView::updateHighlightLineWidth() {
  if (!latestHighlightedLayer || !appHost) {
    return;
  }

  // 获取高亮图层，我们知道它是 ShapeLayer 类型（在 highlightLayerAndCheckRedraw 中创建）
  auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestHighlightedLayer);

  // 获取高亮图层的变换矩阵
  auto globalMatrix = latestHighlightedLayer->matrix();

  // 计算缩放比例，调整线宽以保持视觉一致性
  // 同时考虑全局缩放(lastZoom)和图层变换矩阵
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  float layerAvgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;

  // 结合全局缩放和图层缩放计算最终的缩放比例
  float totalScale = layerAvgScale * lastZoom;
  float adjustedLineWidth =
      totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;

  // 更新线宽
  shapeLayer->setLineWidth(adjustedLineWidth);
}

}  // namespace displaylist