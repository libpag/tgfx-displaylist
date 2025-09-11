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
#include "drawers/Drawer.h"
#include "tgfx/core/Point.h"
#include "tgfx/layers/ImageLayer.h"
#include "tgfx/layers/TextLayer.h"

using namespace emscripten;

namespace displaylist {
TGFXBaseView::TGFXBaseView(const std::string& canvasID) : canvasID(canvasID) {
  appHost = std::make_shared<drawers::AppHost>();
  lastDrawIndex = -1;
  lastZoom = 0;
  lastOffsetX = 0;
  lastOffsetY = 0;
}

bool TGFXBaseView::updateSize(float devicePixelRatio) {
  if (canvasID.empty()) return false;

  int width = 0;
  int height = 0;
  emscripten_get_canvas_element_size(canvasID.c_str(), &width, &height);

  width = std::max(1, width);
  height = std::max(1, height);

  auto sizeChanged = appHost->updateScreen(width, height, devicePixelRatio);

  if (sizeChanged) {
    window = nullptr;
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
  if (window) {
    auto device = window->getDevice();
    if (!device || !device->lockContext()) {
      window = nullptr;
    } else {
      device->unlock();
    }
  }

  lastDrawIndex = drawIndex;
  lastZoom = zoom;
  lastOffsetX = offsetX;
  lastOffsetY = offsetY;

  if (appHost->width() <= 0 || appHost->height() <= 0) {
    return true;
  }
  //
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
  auto canvas = surface->getCanvas();
  canvas->clear();
  if (appHost->width() > 0 && appHost->height() > 0) {
    drawers::Drawer::DrawBackground(canvas, appHost.get());
  }
  auto drawer = drawers::Drawer::GetByIndex(drawIndex % drawers::Drawer::Count());
  drawer->displayList.setZoomScale(zoom);
  drawer->displayList.setContentOffset(offsetX, offsetY);
  drawer->build(appHost.get());
  drawer->displayList.render(canvas->getSurface(), false);
  context->flushAndSubmit();
  window->present(context);
  device->unlock();
  return true;
}

void TGFXBaseView::setAllowBlur(bool allowBlur) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return;
  }

  drawer->displayList.setAllowZoomBlur(allowBlur);
}

void TGFXBaseView::setShowDirtyRect(bool isVisible) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return;
  }
  drawer->displayList.showDirtyRegions(isVisible);
}

void TGFXBaseView::setRenderMode(int mode) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return;
  }
  drawer->displayList.setRenderMode(static_cast<tgfx::RenderMode>(mode));
}

void TGFXBaseView::setTileSize(int size) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return;
  }
  drawer->displayList.setTileSize(size);
}

void TGFXBaseView::setMaxTileCount(int count) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return;
  }
  drawer->displayList.setMaxTileCount(count);
}
std::vector<std::string> TGFXBaseView::getDrawerNames() {
  auto names = drawers::Drawer::Names();
  return names;
}

bool TGFXBaseView::highlightLayerAndCheckRedraw(float x, float y) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return false;
  }
  auto layers = drawer->getLayersUnderPoint(x, y);
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
      if (highLightLayerIndex == latestHighlightedLayer->getChildIndex(layer)) {
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

  return true;
}

bool TGFXBaseView::resetHighlightLayer() {
  if (!latestHighlightedLayer) {
    return false;
  }

  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
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

  return true;
}

bool TGFXBaseView::selectMoveLayer(float pointX, float pointY) {
  auto drawer = drawers::Drawer::GetByIndex(lastDrawIndex);
  if (!drawer) {
    return false;
  }
  auto layers = drawer->getLayersUnderPoint(pointX, pointY);

  if (layers.size() < 1) {
    return false;
  }

  moveLayer = layers[0];

  return true;
}

bool TGFXBaseView::moveHighlightLayer(float deltaX, float deltaY) {

  if (moveLayer == nullptr) {
    return false;
  }

  auto matrix = moveLayer->matrix();
  matrix.preTranslate(deltaX, deltaY);

  moveLayer->setMatrix(matrix);

  return true;
}

}  // namespace displaylist

// Error: Undefined symbol: main
// Note: A `main` function must be implemented as the entry point for the application.
// Without it, the WebAssembly build will fail. Ensure that you have defined a `main` function
// or correctly specified an alternative entry point during the build process.

int main() {
  return 0;
}