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
//
//
//
using namespace emscripten;

namespace displaylist {

// 默认高亮线宽为 5.0f
float TGFXBaseView::s_highlightLineWidth = 5.0f;
// 角控制器大小比例（相对于线宽）
float TGFXBaseView::s_handleSizeFactor = 3.0f;

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
  
  // 画布大小变化时，如果有选中的图层，标记需要重新创建选中效果
  // 让draw方法在下次调用时用正确的缩放值重新创建
  if (selectedTargetLayer) {
    // 保存选中目标，但清除选中效果，让draw方法重新创建
    auto tempSelectedLayer = selectedTargetLayer;
    resetSelectedLayer();
    selectedTargetLayer = tempSelectedLayer;
    appHost->markDirty();
  }
  
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

  // 检查是否需要重新创建选中效果（画布大小变化后）
  if (selectedTargetLayer && !latestSelectedLayer) {
    // 重新创建选中边框（简单创建，具体属性在 updateSelectedLineWidth 中设置）
    auto selectionBorder = tgfx::ShapeLayer::Make();
    selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
    selectionBorder->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204)));
    selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
    selectionBorder->setName("__SELECTION_BORDER__");
    
    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      rootLayer->addChild(selectionBorder);
    }
    
    latestSelectedLayer = selectionBorder;
    
    // 重新创建角控制器
    createCornerHandles(selectedTargetLayer);
    if (rootLayer) {
      for (auto handle : cornerHandles) {
        rootLayer->addChild(handle);
      }
    }
  }

  // 实时更新高亮/选中线宽以保持视觉一致性
  updateHighlightLineWidth();
  updateSelectedLineWidth();
  updateCornerHandles();

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
  
  // 前置判断：如果悬停的是控制图层，直接返回
  if (!layers.empty()) {
    const std::string& layerName = layers[0]->name();
    if (layerName == "__CORNER_HANDLE__" || layerName == "__SELECTION_BORDER__") {
      return false;
    }
  }

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
    // 收缩到路径内，避免在选中边框外侧微微露出
    highlightLayer->setStrokeAlign(tgfx::StrokeAlign::Inside);
    auto maskLayer = layer->mask();

    highlightLayer->setMatrix(globalMatrix);

    if (maskLayer != nullptr) {
      auto maskPath = tgfx::Path();
      maskPath.addRect(maskLayer->getBounds());
      highlightLayer->setPath(maskPath);
    }

    // 若存在选中效果，仅当本次高亮目标与选中目标为同一图层时隐藏，避免双重描边
    if (selectedTargetLayer && selectedTargetLayer == layer) {
      highlightLayer->setVisible(false);
    }

    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      // 若存在选中效果，确保高亮在选中之下（插入到选中索引位置）
      if (latestSelectedLayer && latestSelectedLayer->parent() == rootLayer) {
        int selIndex = rootLayer->getChildIndex(latestSelectedLayer);
        rootLayer->addChildAt(highlightLayer, selIndex);
      } else {
        rootLayer->addChild(highlightLayer);
      }
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

  // 移动结束后，重新显示并更新高亮和选中效果的位置
  if (latestHighlightedLayer && !moveLayers.empty()) {
    // 优先使用选中目标的全局矩阵；若无选中目标则回退到移动的首层
    auto targetLayer = selectedTargetLayer ? selectedTargetLayer : moveLayers[0];
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(targetLayer);
    latestHighlightedLayer->setMatrix(globalMatrix);
    latestHighlightedLayer->setVisible(true);
  }

  if (latestSelectedLayer && !moveLayers.empty()) {
    // 优先使用选中目标的全局矩阵；确保与角控制器一致
    auto targetLayer = selectedTargetLayer ? selectedTargetLayer : moveLayers[0];
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(targetLayer);
    latestSelectedLayer->setMatrix(globalMatrix);
    latestSelectedLayer->setVisible(true);

    // 角控制器基于 selectedTargetLayer 的原始边界与最新矩阵
    removeCornerHandles();
    if (selectedTargetLayer) {
      createCornerHandles(selectedTargetLayer);
    }
    for (auto& handle : cornerHandles) {
      handle->setVisible(true);
    }

    // 同步更新选中线宽，保证丝滑
    updateSelectedLineWidth();
  }

  moveLayers.clear();

  // 标记移动结束，允许重建并显示角控制器
  isMoving = false;

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::selectMoveLayer(float pointX, float pointY) {
  if (!appHost) {
    return false;
  }

  moveLayers.clear();

  // 复用高亮的选层策略：从命中列表挑真实内容层，排除叠加效果层
  auto layers = appHost->getLayersUnderPoint(pointX, pointY);
  if (layers.empty()) {
    return false;
  }

  std::shared_ptr<tgfx::Layer> picked = nullptr;

  // 优先选 Image/Text
  for (auto it : layers) {
    if (it == latestSelectedLayer ||
        std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
      continue;
    }
    auto t = it->type();
    if (t == tgfx::LayerType::Image || t == tgfx::LayerType::Text) {
      picked = it;
      break;
    }
  }

  // 次选 Shape/Solid（如果是遮罩，转为其被遮罩的层）
  if (!picked) {
    for (auto it : layers) {
      if (it == latestSelectedLayer ||
          std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
        continue;
      }
      auto t = it->type();
      if (t == tgfx::LayerType::Shape || t == tgfx::LayerType::Solid) {
        std::shared_ptr<tgfx::Layer> masked = nullptr;
        for (auto check : layers) {
          if (check->mask() == it) {
            masked = check;
            break;
          }
        }
        picked = masked ? masked : it;
        break;
      }
    }
  }

  // 兜底：命中列表中第一个非叠加效果层
  if (!picked) {
    for (auto it : layers) {
      if (it == latestSelectedLayer ||
          std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
        continue;
      }
      picked = it;
      break;
    }
  }

  if (!picked) {
    return false;
  }

  // 将遮罩相关的层一起加入（保持原逻辑）
  for (auto it : layers) {
    if (it->mask() == picked) {
      moveLayers.push_back(it);
    }
  }
  moveLayers.push_back(picked);
  return true;
}

void TGFXBaseView::moveHighlightLayer(float deltaX, float deltaY) {
  if (moveLayers.empty()) {
    return;
  }

  // 标记进入移动状态，避免在移动过程中重建并显示角控制器
  isMoving = true;

  // 移动时隐藏高亮和选中效果
  if (latestHighlightedLayer) {
    latestHighlightedLayer->setVisible(false);
  }
  if (latestSelectedLayer) {
    latestSelectedLayer->setVisible(false);
    for (auto handle : cornerHandles) {
      handle->setVisible(false);
    }
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
    // 仅标记脏区，实际更新在下一帧 draw(zoom, ...) 中按最新缩放统一执行
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

bool TGFXBaseView::selectLayerAndCheckRedraw(float x, float y) {
  if (!appHost) {
    return false;
  }

  printf("=== 选中方法被调用，坐标: (%.1f, %.1f) ===\n", x, y);

  auto layers = appHost->getLayersUnderPoint(x, y);
  
  // 前置判断：如果点击的是控制图层，直接返回
  if (!layers.empty()) {
    const std::string& layerName = layers[0]->name();
    if (layerName == "__CORNER_HANDLE__" || layerName == "__SELECTION_BORDER__") {
      return false;
    }
  }

  if (layers.size() > 0) {
    printf("找到 %zu 个图层\n", layers.size());
    
    auto layer = layers[0];

    // 使用与高亮相同的图层选择逻辑，但要排除选中效果图层和角控制器
    std::shared_ptr<tgfx::Layer> selectedLayer = nullptr;

    // 第一优先级：Image 和 Text（真正的内容层）
    for (auto it : layers) {
      // 跳过选中效果图层和角控制器
      if (it == latestSelectedLayer || 
          std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
        continue;
      }
      
      auto layerType = it->type();
      if (layerType == tgfx::LayerType::Image || layerType == tgfx::LayerType::Text) {
        selectedLayer = it;
        printf("选中高优先级图层: %s\n", layerType == tgfx::LayerType::Image ? "Image" : "Text");
        break;
      }
    }

    // 第二优先级：检查 Shape 层是否是遮罩层，如果是则选择被遮罩的层
    if (!selectedLayer) {
      for (auto it : layers) {
        // 跳过选中效果图层和角控制器
        if (it == latestSelectedLayer || 
            std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
          continue;
        }
        
        auto layerType = it->type();
        if (layerType == tgfx::LayerType::Shape || layerType == tgfx::LayerType::Solid) {
          std::shared_ptr<tgfx::Layer> maskedLayer = nullptr;

          for (auto checkLayer : layers) {
            if (checkLayer->mask() == it) {
              maskedLayer = checkLayer;
              break;
            }
          }

          if (maskedLayer) {
            selectedLayer = maskedLayer;
            printf("选中被遮罩图层\n");
          } else {
            selectedLayer = it;
            printf("选中中优先级图层: %s\n", layerType == tgfx::LayerType::Shape ? "Shape" : "Solid");
          }
          break;
        }
      }
    }

    // 最后选择：使用第一个层（但排除选中效果图层和角控制器）
    if (!selectedLayer) {
      for (auto it : layers) {
        // 跳过选中效果图层和角控制器
        if (it == latestSelectedLayer || 
            std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
          continue;
        }
        selectedLayer = it;
        printf("选中默认图层\n");
        break;
      }
    }

    // 如果没有找到有效的图层，移除现有选中
    if (!selectedLayer) {
      if (latestSelectedLayer) {
        resetSelectedLayer();
      }
      return false;
    }

    layer = selectedLayer;

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
      printf("鼠标不在图层内容边界内\n");
      if (latestSelectedLayer) {
        resetSelectedLayer();
      }
      return false;
    }

    // 如果点击的是已经选中的图层，直接返回；避免重复创建导致“越点越大”
    if (layer == selectedTargetLayer) {
      printf("点击的是已选中的图层，保持选中不重复创建\n");
      appHost->markDirty();
      return true;
    }

    // 总是先清理旧的选择框，避免重复
    resetSelectedLayer();



    printf("创建选中边框\n");

    // 创建选中边框（完全复用高亮的实现逻辑）
    auto selectionBorder = tgfx::ShapeLayer::Make();
    selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
    auto rectPath = tgfx::Path();
    // 使用原始图层边界，避免连续点击放大问题；若存在遮罩，改用遮罩边界以与高亮几何一致
    rectPath.addRect(layer->getBounds(nullptr, true));
    if (layer->mask() != nullptr) {
      tgfx::Path maskPath;
      maskPath.addRect(layer->mask()->getBounds());
      selectionBorder->setPath(maskPath);
    } else {
      selectionBorder->setPath(rectPath);
    }
    // 选中边框设为 80% 透明度
    selectionBorder->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204)));

    // 完全复用高亮的缩放逻辑，确保丝滑缩放
    float scaleX = globalMatrix.getScaleX();
    float scaleY = globalMatrix.getScaleY();
    float layerAvgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;
    
    // 结合全局缩放和图层缩放计算最终的缩放比例（与高亮完全一致）
    float totalScale = layerAvgScale * lastZoom;
    float adjustedLineWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
    
    selectionBorder->setLineWidth(adjustedLineWidth);
    // 与高亮一致，使用 Inside，减少缩放时的微小外泄导致“分层”
    selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
    selectionBorder->setMatrix(globalMatrix);

    // 选中边框路径保持与高亮一致：始终使用选中层的原始内容边界，不因遮罩替换

    // 添加到根图层（与高亮完全一致）
    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      rootLayer->addChild(selectionBorder);
    }

    latestSelectedLayer = selectionBorder;
    selectedTargetLayer = layer;

    printf("创建角控制器\n");

    // 创建四个角控制器，按高亮的最简实现：传入原始图层
    createCornerHandles(layer);

    // 添加角控制器到根图层
    if (rootLayer) {
      for (auto handle : cornerHandles) {
        rootLayer->addChild(handle);
      }
    }

    printf("选中效果创建完成\n");



  } else {
    printf("没有找到图层，取消选中\n");
    if (latestSelectedLayer) {
      resetSelectedLayer();
    } else {
      return false;
    }
  }

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::resetSelectedLayer() {
  if (!latestSelectedLayer) {
    return false;
  }

  if (!appHost) {
    return false;
  }

  // 移除选中边框
  latestSelectedLayer->removeFromParent();
  latestSelectedLayer = nullptr;

  // 移除角控制器
  removeCornerHandles();

  selectedTargetLayer = nullptr;

  appHost->markDirty();
  return true;
}

void TGFXBaseView::createCornerHandles(std::shared_ptr<tgfx::Layer> layer) {
  if (!layer || !appHost) {
    return;
  }
  // 清除之前的角控制器
  removeCornerHandles();

  auto rootLayer = appHost->displayList.root();
  if (!rootLayer) {
    return;
  }

  // 与高亮一致：使用图层到根的全局矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);

  // 角控制器大小与线宽按最简逻辑随缩放变化
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  float layerAvgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;
  float totalScale = layerAvgScale * lastZoom;
  float borderWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
  float handleSize = borderWidth * s_handleSizeFactor;

  // 使用原始图层边界
  auto b = layer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(b.left,  b.top),
    tgfx::Point::Make(b.right, b.top),
    tgfx::Point::Make(b.right, b.bottom),
    tgfx::Point::Make(b.left,  b.bottom),
  };

  for (const auto& c : corners) {
    auto handle = tgfx::ShapeLayer::Make();
    handle->setBlendMode(tgfx::BlendMode::SrcOver);

    tgfx::Path path;
    path.addRect(tgfx::Rect::MakeXYWH(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize));
    handle->setPath(path);

    handle->setFillStyle(tgfx::SolidColor::Make(tgfx::Color::White()));
    handle->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41)));
    handle->setLineWidth(borderWidth);
    handle->setStrokeAlign(tgfx::StrokeAlign::Outside);
    handle->setMatrix(globalMatrix);
    
    // 设置角控制器名称标识
    handle->setName("__CORNER_HANDLE__");

    rootLayer->addChild(handle);
    cornerHandles.push_back(handle);
  }
}

void TGFXBaseView::removeCornerHandles() {
  for (auto handle : cornerHandles) {
    if (handle) {
      handle->removeFromParent();
    }
  }
  cornerHandles.clear();
}

void TGFXBaseView::updateCornerHandles() {
  // 移动中不更新（保持隐藏）；无选中目标不更新
  if (!appHost || !selectedTargetLayer || isMoving) {
    return;
  }

  // 依据当前缩放与矩阵计算线宽与大小
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  float layerAvgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;
  float totalScale = layerAvgScale * lastZoom;
  float borderWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
  float handleSize = borderWidth * s_handleSizeFactor;

  // 原始内容边界用于计算角点（在本地坐标系）
  auto b = selectedTargetLayer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
      tgfx::Point::Make(b.left, b.top),
      tgfx::Point::Make(b.right, b.top),
      tgfx::Point::Make(b.right, b.bottom),
      tgfx::Point::Make(b.left, b.bottom),
  };

  // 若已有 4 个角控制器，则只更新其几何与线宽以实现丝滑；否则重建一次
  if (cornerHandles.size() == 4) {
    for (size_t i = 0; i < 4; ++i) {
      auto& handle = cornerHandles[i];
      if (!handle) {
        continue;
      }
      const auto& c = corners[i];
      tgfx::Path path;
      path.addRect(tgfx::Rect::MakeXYWH(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize));
      handle->setPath(path);
      handle->setLineWidth(borderWidth);
      handle->setMatrix(globalMatrix);
      // 非移动状态下确保可见
      handle->setVisible(true);
    }
  } else {
    removeCornerHandles();
    createCornerHandles(selectedTargetLayer);
  }
}

void TGFXBaseView::setSelectionLineWidth(float width) {
  if (width > 0.0f) {
    s_highlightLineWidth = width;
    // 立即更新现有选中与高亮的线宽
    updateHighlightLineWidth();
    updateSelectedLineWidth();
    updateCornerHandles();
    markDirty();
  }
}

float TGFXBaseView::getSelectionLineWidth() const {
  return s_highlightLineWidth;
}

void TGFXBaseView::setHandleSizeFactor(float factor) {
  if (factor > 0.0f) {
    s_handleSizeFactor = factor;
    // 立即应用到角控制器
    updateCornerHandles();
    markDirty();
  }
}

float TGFXBaseView::getHandleSizeFactor() const {
  return s_handleSizeFactor;
}

void displaylist::TGFXBaseView::updateSelectedLineWidth() {
  if (!appHost || !latestSelectedLayer || !selectedTargetLayer) {
    return;
  }
  // latestSelectedLayer 是 ShapeLayer
  auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestSelectedLayer);

  // 与角控制器一致：使用选中目标图层的全局矩阵计算缩放
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  float layerAvgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;
  float totalScale = layerAvgScale * lastZoom;
  float adjustedLineWidth =
      totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;

  // 每帧同步几何路径为选中目标的原始内容边界，避免父子/遮罩导致的几何滞留
  tgfx::Path rectPath;
  rectPath.addRect(selectedTargetLayer->getBounds(nullptr, true));
  shapeLayer->setPath(rectPath);

  // 同步线宽和矩阵（位置），确保与目标图层保持一致
  shapeLayer->setMatrix(globalMatrix);
  shapeLayer->setLineWidth(adjustedLineWidth);
}

}  // namespace displaylist