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
#include "hello2d/LayerBuilder.h"
#include "tgfx/core/Point.h"
#include "tgfx/layers/ImageLayer.h"
#include "tgfx/layers/TextLayer.h"
#include <cmath>

using namespace emscripten;

namespace displaylist {
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

    for (auto it : layers) {
      if (it->mask() == layer) {
        layer = it;
        break;
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
      if (latestHighlightedLayer && highLightLayerIndex == latestHighlightedLayer->getChildIndex(layer)) {
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
    float scaleX = globalMatrix.getScaleX();
    float scaleY = globalMatrix.getScaleY();
    float avgScale = (std::abs(scaleX) + std::abs(scaleY)) / 2.0f;
    float adjustedLineWidth = avgScale > 0 ? 5.0f / avgScale : 5.0f;
    
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

bool TGFXBaseView::selectMoveLayer(float pointX, float pointY) {
  if (!appHost) {
    return false;
  }
  
  auto layers = appHost->getLayersUnderPoint(pointX, pointY);

  if (layers.size() < 1) {
    return false;
  }

  moveLayer = layers[0];

  return true;
}

void TGFXBaseView::moveHighlightLayer(float deltaX, float deltaY) {
  if (!moveLayer) {
    return;
  }

  auto localDelta = CoordinateTransformer::screenDeltaToLayerDelta(
    deltaX, deltaY, lastZoom, moveLayer
  );
  
  auto matrix = moveLayer->matrix();
  matrix.preTranslate(localDelta.x, localDelta.y);
  moveLayer->setMatrix(matrix);
  
  appHost->markDirty();
}

std::vector<float> TGFXBaseView::getMoveLayerPosition() {
  std::vector<float> position = {0.0f, 0.0f};
  
  if (moveLayer != nullptr) {
    auto matrix = moveLayer->matrix();
    position[0] = matrix.getTranslateX();
    position[1] = matrix.getTranslateY();
  }
  
  return position;
}

std::vector<float> TGFXBaseView::getMoveLayerGlobalMatrix() {
  std::vector<float> matrixInfo = {1.0f, 1.0f, 0.0f, 0.0f};
  
  if (moveLayer != nullptr) {
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

}  // namespace displaylist

// Error: Undefined symbol: main
// Note: A `main` function must be implemented as the entry point for the application.
// Without it, the WebAssembly build will fail. Ensure that you have defined a `main` function
// or correctly specified an alternative entry point during the build process.

int main() {
  return 0;
}