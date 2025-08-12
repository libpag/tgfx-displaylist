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
  
  // 确保最小尺寸为1
  width = std::max(1, width);
  height = std::max(1, height);
  
  auto sizeChanged = appHost->updateScreen(width, height, devicePixelRatio);
  // 尺寸变化时仅标记需要重建窗口
  if (sizeChanged) {
    window = nullptr; // 下次draw时会自动重建
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
  // 检测上下文丢失（通过尝试获取设备）
  if (window) {
    auto device = window->getDevice();
    if (!device || !device->lockContext()) {
      printf("WebGL上下文丢失或设备不可用，正在恢复...\n");
      window = nullptr;
    } else {
      device->unlock();
    }
  }
  // 强制更新状态并重绘
  lastDrawIndex = drawIndex;
  lastZoom = zoom;
  lastOffsetX = offsetX;
  lastOffsetY = offsetY;
  
  // 添加调试日志
  printf("强制重绘: index=%d, zoom=%.2f, offset=(%.2f,%.2f)\n", 
         drawIndex, zoom, offsetX, offsetY);

  if (appHost->width() <= 0 || appHost->height() <= 0) {
    return true;
  }
  // 仅在需要时创建WebGL窗口
  if (window == nullptr) {
    window = tgfx::WebGLWindow::MakeFrom(canvasID);
    if (window == nullptr) {
      printf("WebGL窗口创建失败！\n");
      return true;
    }
    printf("创建新WebGL窗口: %dx%d\n", appHost->width(), appHost->height());
  }
  auto device = window->getDevice();
  if (!device) {
    printf("获取设备失败！\n");
    window = nullptr;
    return true;
  }
  
  auto context = device->lockContext();
  if (!context) {
    printf("获取绘图上下文失败！\n");
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
  // 确保总是绘制背景
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
  auto drawer = drawers::Drawer::GetByName("ConicGradient");
  drawer->displayList.setAllowZoomBlur(allowBlur);
}

void TGFXBaseView::setShowDirtyRect(bool isVisible) {
  auto drawer = drawers::Drawer::GetByName("ConicGradient");
  drawer->displayList.showDirtyRegions(isVisible);
}
std::vector<std::string> TGFXBaseView::getDrawerNames()  {
  return drawers::Drawer::Names();
}

}  // namespace displaylist

// Error: Undefined symbol: main
// Note: A `main` function must be implemented as the entry point for the application.
// Without it, the WebAssembly build will fail. Ensure that you have defined a `main` function
// or correctly specified an alternative entry point during the build process.

int main() {
  return 0;
}