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
#include "CoordinateTransformer.h"
#include "hello2d/LayerBuilder.h"
#include "tgfx/gpu/opengl/webgl/WebGLWindow.h"
#include "tgfx/layers/ShapeLayer.h"
#include "tgfx/layers/SolidColor.h"

namespace displaylist {
class TGFXBaseView {
 public:
  TGFXBaseView(const std::string& canvasID);

  void setImage(const std::string& name, tgfx::NativeImageRef nativeImage);

  bool updateSize(float devicePixelRatio);

  bool draw(int drawIndex, float zoom, float offsetX, float offsetY);

  void setAllowBlur(bool allowBlur);

  void setShowDirtyRect(bool isVisible);
  void setRenderMode(int mode);
  void setTileSize(int size);
  void setMaxTileCount(int count);

  std::vector<std::string> getDrawerNames();

  bool highlightLayerAndCheckRedraw(float x, float y);

  bool resetHighlightLayer();

  bool resetMoveLayers();

  void updateHighlightLineWidth();

  bool selectMoveLayer(float pointX, float pointY);

  void moveHighlightLayer(float deltaX, float deltaY);

  /**
   * 获取当前移动图层的全局变换矩阵信息
   * 返回数组: [scaleX, scaleY, translateX, translateY]
   */
  std::vector<float> getMoveLayerGlobalMatrix();

  // 获取当前选中图层的位置信息（用于调试）
  std::vector<float> getMoveLayerPosition();

  // 选中效果相关方法
  bool selectLayerAndCheckRedraw(float x, float y);
  bool resetSelectedLayer();

  // 角控制器相关方法
  void createCornerHandles(std::shared_ptr<tgfx::Layer> layer);
  void removeCornerHandles();
  void updateCornerHandles();

  // 选中边框线宽更新
  void updateSelectedLineWidth();

  // 线宽和角控制器大小配置方法
  void setSelectionLineWidth(float width);
  float getSelectionLineWidth() const;
  void setHandleSizeFactor(float factor);
  float getHandleSizeFactor() const;

  void markDirty();
  void onWheelEvent();

 protected:
  std::shared_ptr<hello2d::AppHost> appHost;
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

  std::shared_ptr<tgfx::Layer> latestHighlightedLayer = nullptr;
  int highLightLayerIndex = -1;

  std::vector<std::shared_ptr<tgfx::Layer>> moveLayers = {};

  // 选中效果相关成员变量
  std::shared_ptr<tgfx::Layer> latestSelectedLayer = nullptr;
  std::shared_ptr<tgfx::Layer> selectedTargetLayer = nullptr;
  std::vector<std::shared_ptr<tgfx::Layer>> cornerHandles = {};
  bool isMoving = false;

  // 保存当前渲染设置，确保在重新构建layer tree时能够重新应用
  int currentRenderMode = 0;  // 0=Direct, 1=Partial, 2=Tiled
  bool currentAllowBlur = false;
  bool currentShowDirtyRect = false;
  int currentTileSize = 256;
  int currentMaxTileCount = 16;

  // 重新应用所有渲染设置
  void reapplyRenderSettings();

  // 静态成员变量：全局高亮线宽配置和角控制器大小比例
  static float s_highlightLineWidth;
  static float s_handleSizeFactor;
};
}  // namespace displaylist
