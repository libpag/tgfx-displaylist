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

#include "MouseStateManager.h"

namespace displaylist {

bool MouseStateManager::isPointInCornerHandle(float worldX, float worldY) const {
  // 使用回调函数进行角控制器检测
  if (cornerHandleDetectionCallback_) {
    return cornerHandleDetectionCallback_(worldX, worldY);
  }
  
  // 如果没有设置回调，返回false
  return false;
}

void MouseStateManager::updateMouseState(float worldX, float worldY, MouseEventType eventType) {
  lastMouseX_ = worldX;
  lastMouseY_ = worldY;

  switch (eventType) {
    case MouseEventType::Move:
      if (!isMouseDown_) {
        currentState_ = MouseState::Hovering;
      }
      break;
    
    case MouseEventType::Down:
      isMouseDown_ = true;
      currentState_ = MouseState::Dragging;
      break;
    
    case MouseEventType::Up:
      isMouseDown_ = false;
      currentState_ = MouseState::Idle;
      break;
  }
}

MouseState MouseStateManager::getCurrentState() const {
  return currentState_;
}

void MouseStateManager::reset() {
  currentState_ = MouseState::Idle;
  isMouseDown_ = false;
  lastMouseX_ = 0.0f;
  lastMouseY_ = 0.0f;
}

void MouseStateManager::setLayerDetectionCallback(std::function<std::shared_ptr<tgfx::Layer>(float, float)> callback) {
  layerDetectionCallback_ = callback;
}

void MouseStateManager::setCornerHandleDetectionCallback(std::function<bool(float, float)> callback) {
  cornerHandleDetectionCallback_ = callback;
}

void MouseStateManager::setSelectionBorderDetectionCallback(std::function<bool(float, float)> callback) {
  selectionBorderDetectionCallback_ = callback;
}

void MouseStateManager::setCursorChangeCallback(std::function<void(CursorStyle)> callback) {
  cursorChangeCallback_ = callback;
}

}  // namespace displaylist