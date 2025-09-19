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
#include "TGFXBaseView.h"
#include "hello2d/LayerBuilder.h"
#include "tgfx/core/Point.h"
#include "tgfx/layers/ImageLayer.h"
#include "tgfx/layers/TextLayer.h"

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

  // 在改变窗口大小前，等待当前渲染任务完成
  if (window) {
    auto device = window->getDevice();
    if (device) {
      auto context = device->lockContext();
      if (context) {
        printf("Waiting for render completion before resize...\n");
        context->flushAndSubmit();  // 等待所有渲染任务完成
        device->unlock();
        printf("Render completion confirmed, proceeding with resize\n");
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
    printf("Canvas size changed: %dx%d, devicePixelRatio: %.2f, resetting window\n", 
           width, height, devicePixelRatio);
    window = nullptr;  // 现在安全地重置窗口
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
    printf("Creating new WebGL window for canvas: %s\n", canvasID.c_str());
    window = tgfx::WebGLWindow::MakeFrom(canvasID);
    if (window == nullptr) {
      printf("Failed to create WebGL window!\n");
      return true;
    }
    printf("WebGL window created successfully\n");
  }
  
  auto device = window->getDevice();
  if (!device) {
    printf("Device is null! Resetting window.\n");
    window = nullptr;
    return true;
  }

  auto context = device->lockContext();
  if (!context) {
    printf("Failed to lock context! Resetting window.\n");
    window = nullptr;
    return true;
  }
  
  auto surface = window->getSurface(context);
  if (surface == nullptr) {
    printf("Surface is null! Unlocking device.\n");
    device->unlock();
    return true;
  }

  appHost->updateZoomAndOffset(zoom, tgfx::Point(offsetX, offsetY));
  auto canvas = surface->getCanvas();
  if (canvas == nullptr) {
    printf("Canvas is null! Surface exists but canvas creation failed.\n");
    device->unlock();
    return true;
  }
  canvas->clear();
  
  // 在每次draw之前重新应用渲染设置，确保在重新构建layer tree后设置不丢失
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

    switch (layer->type()) {
      case tgfx::LayerType::Shape: {
        auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(layer);
        strokeStyles = shapeLayer->strokeStyles();
        shapeLayer->addStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41)));
        shapeLayer->setLineWidth(5);
        latestHighlightedLayer = layer;
      } break;
      default: {
        auto highlightLayer = tgfx::ShapeLayer::Make();
        highlightLayer->setBlendMode(tgfx::BlendMode::SrcOver);
        auto rectPath = tgfx::Path();
        rectPath.addRect(layer->getBounds());
        highlightLayer->setPath(rectPath);

        highlightLayer->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41)));
        highlightLayer->setLineWidth(5);
        auto maskLayer = layer->mask();
        auto parentLayer = layer->parent();
        highlightLayer->setMatrix(layer->matrix());
        if (maskLayer != nullptr) {
          auto maskPath = tgfx::Path();
          maskPath.addRect(maskLayer->getBounds());
          highlightLayer->setPath(maskPath);
        }
        auto index = parentLayer->getChildIndex(layer);
        parentLayer->addChildAt(highlightLayer, index + 1);
        highLightLayerIndex = parentLayer->getChildIndex(highlightLayer);
        latestHighlightedLayer = highlightLayer;
      } break;
    }

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

  
  switch (latestHighlightedLayer->type()) {
    case tgfx::LayerType::Shape: {
      auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestHighlightedLayer);
      shapeLayer->removeStrokeStyles();
      shapeLayer->setStrokeStyles(strokeStyles);
      latestHighlightedLayer = nullptr;
      break;
    }
    default:
      if (highLightLayerIndex >= 0) {
        latestHighlightedLayer->removeFromParent();
        latestHighlightedLayer = nullptr;
        highLightLayerIndex = -1;
      }
      break;
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

  // 首先将屏幕坐标增量转换为视图坐标增量（考虑前端的缩放）
  float viewDeltaX = deltaX / lastZoom;
  float viewDeltaY = deltaY / lastZoom;
  
  // 然后将视图坐标的两个点转换为图层本地坐标
  auto viewPoint1 = tgfx::Point::Make(0, 0);
  auto viewPoint2 = tgfx::Point::Make(viewDeltaX, viewDeltaY);
  
  auto localPoint1 = moveLayer->globalToLocal(viewPoint1);
  auto localPoint2 = moveLayer->globalToLocal(viewPoint2);
  
  // 计算图层本地坐标的增量
  float localDeltaX = localPoint2.x - localPoint1.x;
  float localDeltaY = localPoint2.y - localPoint1.y;
  
  // 应用图层本地坐标的移动
  auto matrix = moveLayer->matrix();
  matrix.preTranslate(localDeltaX, localDeltaY);
  moveLayer->setMatrix(matrix);
  
  printf("屏幕增量: (%.2f, %.2f) -> 视图增量: (%.2f, %.2f) -> 图层本地增量: (%.2f, %.2f) [zoom=%.2f]\n", 
         deltaX, deltaY, viewDeltaX, viewDeltaY, localDeltaX, localDeltaY, lastZoom);
  
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
  std::vector<float> matrixInfo = {1.0f, 1.0f, 0.0f, 0.0f}; // [scaleX, scaleY, translateX, translateY]
  
  if (moveLayer != nullptr) {
    // 使用公开的 localToGlobal 方法来计算变换
    // 通过变换单位向量来获取缩放信息
    auto origin = moveLayer->localToGlobal(tgfx::Point::Make(0, 0));
    auto unitX = moveLayer->localToGlobal(tgfx::Point::Make(1, 0));
    auto unitY = moveLayer->localToGlobal(tgfx::Point::Make(0, 1));
    
    // 计算缩放比例
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
  
  // 重新应用所有渲染设置，确保在重新构建layer tree后设置不丢失
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