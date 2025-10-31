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
#include "MouseStateManager.h"

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

  // 旋转操作相关方法
  void rotateSelectedLayer(float angle, float worldCenterX, float worldCenterY);
  std::vector<float> getSelectedLayerCenter();
  
  // 缩放操作相关方法
  void scaleSelectedLayer(float scaleX, float scaleY, float worldCenterX, float worldCenterY);
  
  // 使用本地坐标作为枢轴的缩放方法
  void scaleSelectedLayerWithLocalPivot(float scaleX, float scaleY, float localPivotX, float localPivotY);
  
  // 获取选中图层信息
  std::vector<std::string> getSelectedLayerInfo();
  
  // 获取选中图层的旋转角度（弧度）
  float getSelectedLayerRotation();

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
  
  // 获取选中图层的4个顶点坐标（屏幕坐标系）
  // 返回数组: [左上角x, 左上角y, 右上角x, 右上角y, 右下角x, 右下角y, 左下角x, 左下角y]
  std::vector<float> getSelectedLayerCorners();
  
  // 获取角控制器的世界坐标（直接从角控制器获取）
  // 参数：cornerIndex (0=左上, 1=右上, 2=右下, 3=左下)
  // 返回数组: [x, y]，如果角控制器不存在则返回空数组
  std::vector<float> getCornerHandlePosition(int cornerIndex);
  
  // 获取选中图层的本地边界角坐标
  // 参数：cornerIndex (0=左上, 1=右上, 2=右下, 3=左下)
  // 返回数组: [localX, localY]，如果没有选中图层则返回空数组
  std::vector<float> getSelectedLayerLocalCorner(int cornerIndex);
  
  // 将选中图层的本地坐标转换为世界坐标
  // 参数：localX, localY - 本地坐标
  // 返回数组: [worldX, worldY]，如果没有选中图层则返回空数组
  std::vector<float> localToWorldCoords(float localX, float localY);
  
  // 旋转区域检测
  bool isPointInRotateZone(float x, float y);

  // 选中边框线宽更新
  void updateSelectedLineWidth();

  // 线宽和角控制器大小配置方法
  void setSelectionLineWidth(float width);
  float getSelectionLineWidth() const;
  void setHandleSizeFactor(float factor);
  float getHandleSizeFactor() const;

  void markDirty();
  void onWheelEvent();

  // 鼠标状态管理相关方法
  void onMouseMove(float x, float y);
  void onMouseDown(float x, float y);
  void onMouseUp(float x, float y);
  MouseState getCurrentMouseState() const;
  void resetMouseState();
  
  // 角控制器检测方法（需要暴露给 JavaScript）
  bool isPointInCornerHandle(float x, float y);
  
  // 选中图层检测方法（需要暴露给 JavaScript）
  bool isPointInSelectedLayer(float x, float y);
  bool isPointInSelectionBorder(float x, float y);

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

  // === 重构后的核心方法 ===
  
  // 图层选择核心逻辑（抽取公共代码）
  std::shared_ptr<tgfx::Layer> selectBestLayerAtPoint(float x, float y, 
      const std::vector<std::shared_ptr<tgfx::Layer>>& excludeLayers = {});
  std::shared_ptr<tgfx::Layer> selectBestLayerAtPoint(float x, float y);

  // 选中效果统一管理
  void createSelectionEffect(std::shared_ptr<tgfx::Layer> layer);
  void updateSelectionEffect();
  void removeSelectionEffect();

  // 变换操作统一接口（为未来扩展做准备）
  bool startTransformOperation(float x, float y);  // TODO: 完成旋转和缩放的检测逻辑
  void applyTransform(float deltaX, float deltaY);  // TODO: 完成旋转和缩放变换
  void endTransformOperation();

  // 辅助方法
  bool isPointInContentBounds(std::shared_ptr<tgfx::Layer> layer, float x, float y);
  float calculateAdjustedLineWidth(std::shared_ptr<tgfx::Layer> layer);
  tgfx::Matrix getLayerGlobalMatrix(std::shared_ptr<tgfx::Layer> layer);
  
  // 状态管理和内存管理改进
  bool validateSelectionState();

  // 鼠标状态管理器
  std::unique_ptr<MouseStateManager> mouseStateManager;
  
  // 鼠标状态相关辅助方法
  InteractionZone detectMouseInteractionZone(float x, float y);
  
  // 智能指针查找辅助方法
  std::shared_ptr<tgfx::Layer> findSharedPtrForLayer(std::shared_ptr<tgfx::Layer> root, tgfx::Layer* target);
  
  // 控制图层边框检测辅助方法
  bool isPointOnControlLayerBorder(float x, float y, std::shared_ptr<tgfx::Layer> controlLayer);
};
}  // namespace displaylist
