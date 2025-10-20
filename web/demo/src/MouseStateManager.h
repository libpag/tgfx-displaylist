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

#include <functional>
#include <memory>
#include "tgfx/layers/Layer.h"

namespace displaylist {

/**
 * 鼠标状态枚举
 */
enum class MouseState {
  Idle,      // 空闲状态
  Hovering,  // 悬停状态
  Dragging,  // 拖拽状态
  Scaling,   // 缩放状态
  Rotating   // 旋转状态
};

/**
 * 鼠标事件类型
 */
enum class MouseEventType {
  Move,  // 鼠标移动
  Down,  // 鼠标按下
  Up     // 鼠标抬起
};

/**
 * 交互区域枚举
 */
enum class InteractionZone {
  Empty,           // 空白区域
  Layer,           // 图层区域
  CornerHandle,    // 角控制器
  SelectionBorder, // 选择边框
  RotateZone       // 旋转区域
};

/**
 * 光标样式枚举
 */
enum class CursorStyle {
  Default,    // 默认光标
  Move,       // 移动光标
  Resize,     // 缩放光标
  Rotate,     // 旋转光标
  Pointer     // 指针光标
};

/**
 * 鼠标状态管理器
 * 用于管理鼠标交互状态和光标样式
 */
class MouseStateManager {
 public:
  MouseStateManager() = default;
  ~MouseStateManager() = default;

  /**
   * 检查点是否在角控制器上
   */
  bool isPointInCornerHandle(float worldX, float worldY) const;

  /**
   * 更新鼠标状态
   */
  void updateMouseState(float worldX, float worldY, MouseEventType eventType);

  /**
   * 获取当前鼠标状态
   */
  MouseState getCurrentState() const;

  /**
   * 重置鼠标状态
   */
  void reset();

  /**
   * 设置图层检测回调
   */
  void setLayerDetectionCallback(std::function<std::shared_ptr<tgfx::Layer>(float, float)> callback);

  /**
   * 设置角控制器检测回调
   */
  void setCornerHandleDetectionCallback(std::function<bool(float, float)> callback);

  /**
   * 设置选择边框检测回调
   */
  void setSelectionBorderDetectionCallback(std::function<bool(float, float)> callback);

  /**
   * 设置光标变化回调
   */
  void setCursorChangeCallback(std::function<void(CursorStyle)> callback);

 private:
  // 鼠标状态相关的私有成员
  MouseState currentState_ = MouseState::Idle;
  bool isMouseDown_ = false;
  float lastMouseX_ = 0.0f;
  float lastMouseY_ = 0.0f;

  // 回调函数
  std::function<std::shared_ptr<tgfx::Layer>(float, float)> layerDetectionCallback_;
  std::function<bool(float, float)> cornerHandleDetectionCallback_;
  std::function<bool(float, float)> selectionBorderDetectionCallback_;
  std::function<void(CursorStyle)> cursorChangeCallback_;
};

}  // namespace displaylist