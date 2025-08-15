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
#pragma once
#include <emscripten/bind.h>
#include "drawers/Drawer.h"
#include "tgfx/gpu/opengl/webgl/WebGLWindow.h"

namespace displaylist {
class TGFXBaseView {
 public:
  TGFXBaseView(const std::string& canvasID);

  void setImagePath(const std::string& name, const std::string& imagePath);

  void setImageRef(const std::string& name, emscripten::val imageRef);


  bool updateSize(float devicePixelRatio);

  bool draw(int drawIndex, float zoom, float offsetX, float offsetY);

  void setAllowBlur(bool allowBlur, int drawIndex = 0);

  void setShowDirtyRect(bool isVisible, int drawIndex = 0);
  void setRenderMode(int mode, int drawIndex = 0);
  void setTileSize(int size, int drawIndex = 0);
  void setMaxTileCount(int count, int drawIndex = 0);

  std::vector<std::string> getDrawerNames();
  std::string getDrawerName(int index);

 protected:
  std::shared_ptr<drawers::AppHost> appHost;
  std::shared_ptr<tgfx::WebGLWindow> window;
  
  int width() const { 
    int w = 0, h = 0;
    emscripten_get_canvas_element_size(canvasID.c_str(), &w, &h);
    return w;
  }
  int height() const { 
    int w = 0, h = 0;
    emscripten_get_canvas_element_size(canvasID.c_str(), &w, &h);
    return h;
  }
  
  int lastDrawIndex = -1;
  float lastZoom = 0;
  float lastOffsetX = 0;
  float lastOffsetY = 0;

 private:
  std::string canvasID = "";
};
}  // namespace displaylist
