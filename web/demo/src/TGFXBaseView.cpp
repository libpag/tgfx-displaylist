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

void TGFXBaseView::setImagePath(const std::string& name, const std::string& imagePath) {
  auto image = tgfx::Image::MakeFromFile(imagePath.c_str());
  if (image) {
    appHost->addImage(name, std::move(image));
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

void TGFXBaseView::setAllowBlur(bool allowBlur ,int drawIndex) {
  const std::string& drawerName = getDrawerName(drawIndex);

  auto drawer = drawers::Drawer::GetByName(drawerName);
  
  drawer->displayList.setAllowZoomBlur(allowBlur);
}

void TGFXBaseView::setShowDirtyRect(bool isVisible, int drawIndex) {
  const std::string& drawerName = getDrawerName(drawIndex);
  auto drawer = drawers::Drawer::GetByName(drawerName);
  if (!drawer) {
    return;
  }
  drawer->displayList.showDirtyRegions(isVisible);
}

void TGFXBaseView::setRenderMode(int mode, int drawIndex) {
  const std::string& drawerName = getDrawerName(drawIndex);
  auto drawer = drawers::Drawer::GetByName(drawerName);
  if (!drawer) {
    return;
  }
  drawer->displayList.setRenderMode(static_cast<tgfx::RenderMode>(mode));
}

void TGFXBaseView::setTileSize(int size, int drawIndex) {
  const std::string& drawerName = getDrawerName(drawIndex);
  auto drawer = drawers::Drawer::GetByName(drawerName);
  if (!drawer) {
    return;
  }
  drawer->displayList.setTileSize(size);
}

void TGFXBaseView::setMaxTileCount(int count, int drawIndex) {
  const std::string& drawerName = getDrawerName(drawIndex);
  auto drawer = drawers::Drawer::GetByName(drawerName);
  if (!drawer) {
    return;
  }
  drawer->displayList.setMaxTileCount(count);
}
std::vector<std::string> TGFXBaseView::getDrawerNames()  {
  return drawers::Drawer::Names();
}
std::string TGFXBaseView::getDrawerName(int index) {
  auto drawerNames = getDrawerNames();
  if (index < 0 || index >= static_cast<int>(drawerNames.size())) {
    return "";
  }
  const std::string& drawerName = drawerNames[static_cast<size_t>(index)];
  return drawerName;
}

}  // namespace displaylist

// Error: Undefined symbol: main
// Note: A `main` function must be implemented as the entry point for the application.
// Without it, the WebAssembly build will fail. Ensure that you have defined a `main` function
// or correctly specified an alternative entry point during the build process.

int main() {
  return 0;
}