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
#include <unordered_set>
#include "hello2d/LayerBuilder.h"
#include "tgfx/core/Point.h"
#include "tgfx/layers/ImageLayer.h"
#include "tgfx/layers/TextLayer.h"
#include "tgfx/layers/ShapeLayer.h"


using namespace emscripten;
namespace displaylist {

// 默认高亮线宽为 5.0f
float TGFXBaseView::s_highlightLineWidth = 3.0f;
// 角控制器大小比例（相对于线宽）
float TGFXBaseView::s_handleSizeFactor = 2.0f;

TGFXBaseView::TGFXBaseView(const std::string& canvasID) : canvasID(canvasID) {
  appHost = std::make_shared<hello2d::AppHost>();
  lastDrawIndex = -1;
  lastZoom = 0;
  lastOffsetX = 0;
  lastOffsetY = 0;
  
  // 初始化鼠标状态管理器
  mouseStateManager = std::make_unique<MouseStateManager>();
  
  // 设置回调函数
  mouseStateManager->setLayerDetectionCallback([this](float x, float y) -> std::shared_ptr<tgfx::Layer> {
    std::vector<std::shared_ptr<tgfx::Layer>> allLayers;
    return selectBestLayerAtPoint(x, y, allLayers);
  });
  
  mouseStateManager->setCornerHandleDetectionCallback([this](float x, float y) -> bool {
    return isPointInCornerHandle(x, y);
  });
  
  mouseStateManager->setSelectionBorderDetectionCallback([this](float x, float y) -> bool {
    return isPointInSelectionBorder(x, y);
  });
  
  mouseStateManager->setCursorChangeCallback([](CursorStyle /*style*/) {
    // 光标变化回调，可以在这里添加额外的处理逻辑
    printf("[光标回调] 光标样式已更改\n");
  });
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

  // 【核心修复】保存根图层的当前矩阵，避免被 updateScreen() 重置
  tgfx::Matrix savedRootMatrix;
  bool hasRootLayer = false;
  auto displayListRoot = appHost->displayList.root();
  if (displayListRoot && !displayListRoot->children().empty()) {
    auto root = displayListRoot->children()[0];
    if (root) {
      savedRootMatrix = root->matrix();
      hasRootLayer = true;
    }
  }

  auto sizeChanged = appHost->updateScreen(width, height, devicePixelRatio);

  // 【核心修复】恢复根图层矩阵，保留用户的手动调整
  if (sizeChanged && hasRootLayer && displayListRoot && !displayListRoot->children().empty()) {
    auto root = displayListRoot->children()[0];
    if (root) {
      root->setMatrix(savedRootMatrix);
    }
  }

  if (sizeChanged) {
    window.reset();
    appHost->markDirty();
  }
  resetHighlightLayer();
  
  // 画布大小变化时，如果有选中的图层，标记需要重新创建选中效果
  // 让draw方法在下次调用时用正确的缩放值重新创建
  if (selectedTargetLayer) {
    // 验证选中目标是否仍然有效
    if (validateSelectionState() && selectedTargetLayer) {
      // 保存有效的选中目标，清除选中效果，让draw方法重新创建
      auto tempSelectedLayer = selectedTargetLayer;
      
      // 只清除视觉效果，不清除目标引用
      if (latestSelectedLayer) {
        if (latestSelectedLayer->parent()) {
          latestSelectedLayer->removeFromParent();
        }
        latestSelectedLayer.reset();
      }
      removeCornerHandles();
      
      // 恢复目标引用
      selectedTargetLayer = tempSelectedLayer;
      appHost->markDirty();
    }
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
  // 在绘制前验证状态
  validateSelectionState();
  
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
    window.reset();
    return true;
  }

  auto context = device->lockContext();
  if (!context) {
    window.reset();
    return true;
  }

  auto surface = window->getSurface(context);
  if (surface == nullptr) {
    device->unlock();
    return true;
  }

  // ========== 全局缩放诊断输出 ==========
  static float lastDiagnosticZoom = 0;
  static float lastDiagnosticOffsetX = 0;
  static float lastDiagnosticOffsetY = 0;
  
  bool zoomChanged = (lastDiagnosticZoom != zoom || lastDiagnosticOffsetX != offsetX || lastDiagnosticOffsetY != offsetY);
  
  if (selectedTargetLayer && zoomChanged) {
    printf("\n========== [全局缩放] updateZoomAndOffset 调用前 ==========\n");
    printf("[输入参数] zoom=%.6f, offset=(%.2f, %.2f)\n", zoom, offsetX, offsetY);
    
    // 输出选中图层的矩阵
    auto layerMatrix = selectedTargetLayer->matrix();
    printf("[缩放前] 选中图层矩阵: [%.6f, %.6f, %.2f]\n", 
           layerMatrix.getScaleX(), layerMatrix.getSkewY(), layerMatrix.getTranslateX());
    printf("                      [%.6f, %.6f, %.2f]\n", 
           layerMatrix.getSkewX(), layerMatrix.getScaleY(), layerMatrix.getTranslateY());
    
    // 输出世界坐标边界
    auto root = selectedTargetLayer->root();
    auto worldBounds = selectedTargetLayer->getBounds(root, true);
    printf("[缩放前] 世界坐标边界: left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
           worldBounds.left, worldBounds.top, worldBounds.right, worldBounds.bottom);
    
    lastDiagnosticZoom = zoom;
    lastDiagnosticOffsetX = offsetX;
    lastDiagnosticOffsetY = offsetY;
  }

  appHost->updateZoomAndOffset(zoom, tgfx::Point(offsetX, offsetY));
  
  if (selectedTargetLayer && zoomChanged) {
    printf("\n========== [全局缩放] updateZoomAndOffset 调用后 ==========\n");
    
    // 输出选中图层的矩阵（应该没有变化）
    auto layerMatrix = selectedTargetLayer->matrix();
    printf("[缩放后] 选中图层矩阵: [%.6f, %.6f, %.2f]\n", 
           layerMatrix.getScaleX(), layerMatrix.getSkewY(), layerMatrix.getTranslateX());
    printf("                      [%.6f, %.6f, %.2f]\n", 
           layerMatrix.getSkewX(), layerMatrix.getScaleY(), layerMatrix.getTranslateY());
    
    // 输出世界坐标边界（应该没有变化）
    auto root = selectedTargetLayer->root();
    auto worldBounds = selectedTargetLayer->getBounds(root, true);
    printf("[缩放后] 世界坐标边界: left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
           worldBounds.left, worldBounds.top, worldBounds.right, worldBounds.bottom);
    
    printf("========== [全局缩放] 结束 ==========\n\n");
  }

  // 检查是否需要重新创建选中效果（画布大小变化后）
  if (selectedTargetLayer && !latestSelectedLayer) {
    // 重新创建选中边框（简单创建，具体属性在 updateSelectedLineWidth 中设置）
    auto selectionBorder = tgfx::ShapeLayer::Make();
    selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
    selectionBorder->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204)));
    selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
    selectionBorder->setName("__SELECTION_BORDER__");
    
    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      rootLayer->addChild(selectionBorder);
    }
    
    latestSelectedLayer = selectionBorder;
    
    // 立即更新边框属性，而不是等待缩放变化
    updateSelectedLineWidth();
    
    // 重新创建角控制器
    createCornerHandles(selectedTargetLayer);
    if (rootLayer) {
      for (auto handle : cornerHandles) {
        rootLayer->addChild(handle);
      }
    }
    // 立即更新角控制器位置
    updateCornerHandles();
  }

  // 只在有高亮或选中图层时才更新，避免无必要的更新导致持续渲染
  // 并且只在缩放或偏移发生变化时才更新（保持视觉一致性）
  static float lastUpdateZoom = 0;
  static float lastUpdateOffsetX = 0;
  static float lastUpdateOffsetY = 0;
  
  
  bool needsUpdate = (lastUpdateZoom != zoom || lastUpdateOffsetX != offsetX || lastUpdateOffsetY != offsetY);
  
  if (needsUpdate) {
    if (latestHighlightedLayer) {
      updateHighlightLineWidth();
    }
    
    // 【新增】更新框选框线宽（只受全局缩放影响）
    if (isBoxSelecting && selectionBoxLayer) {
      float adjustedLineWidth = zoom > 0 ? s_highlightLineWidth / zoom : s_highlightLineWidth;
      auto boxShape = std::static_pointer_cast<tgfx::ShapeLayer>(selectionBoxLayer);
      boxShape->setLineWidth(adjustedLineWidth);
    }
    
    // 单选模式：更新选中边框和角控制器
    if (latestSelectedLayer && !isMultiSelection) {
      updateSelectedLineWidth();
      updateCornerHandles();
    }
    
    // 【新增】多选模式：更新多选边框、内部高亮和角控制器
    if (latestSelectedLayer && isMultiSelection && !selectedLayers.empty()) {
      auto aabb = calculateAxisAlignedBoundingBox();
      
      // 【最终理解】多选AABB边框和角控制器应该只受全局缩放影响。
      // 理由：
      // 1. AABB是轴对齐矩形，在世界坐标系，Matrix=单位矩阵，几何上不受图层缩放影响
      // 2. 用户用角控制器缩放图层时，AABB的大小会自然改变（因为包围的图层变大/小了）
      // 3. 如果线宽也跟着图层缩放变化，会导致双重视觉反馈，显得"太夸张"
      // 4. 只考虑lastZoom，保持边框和角控制器的视觉粗细稳定，更符合直觉
      float borderLineWidth = lastZoom > 0 ? s_highlightLineWidth / lastZoom : s_highlightLineWidth;
      
      // 1. 更新多选边框（AABB）
      auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestSelectedLayer);
      tgfx::Path rectPath;
      rectPath.addRect(aabb);
      shapeLayer->setPath(rectPath);
      shapeLayer->setLineWidth(borderLineWidth);
      // AABB在世界坐标系，矩阵保持单位矩阵
      shapeLayer->setMatrix(tgfx::Matrix::I());
      
      // 2. 更新内部高亮的线宽（每个选中图层独立计算，参考单选逻辑）
      if (tempHighlightLayers.size() == selectedLayers.size()) {
        for (size_t i = 0; i < selectedLayers.size(); ++i) {
          auto& layer = selectedLayers[i];
          auto& highlight = tempHighlightLayers[i];
          if (!layer || !highlight) continue;
          
          auto highlightShape = std::static_pointer_cast<tgfx::ShapeLayer>(highlight);
          
          // 与单选逻辑一致：计算该图层的全局缩放
          auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
          float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                                   globalMatrix.getSkewY() * globalMatrix.getSkewY());
          float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                                   globalMatrix.getScaleY() * globalMatrix.getScaleY());
          float layerScale = (scaleX + scaleY) / 2.0f;
          float layerTotalScale = layerScale * lastZoom;
          float layerLineWidth = layerTotalScale > 0 ? s_highlightLineWidth / layerTotalScale : s_highlightLineWidth;
          
          // 更新路径、矩阵和线宽
          tgfx::Path path;
          path.addRect(layer->getBounds(nullptr, true));
          highlightShape->setPath(path);
          highlightShape->setMatrix(globalMatrix);
          highlightShape->setLineWidth(layerLineWidth);
        }
      }
      
      // 3. 更新角控制器（AABB的角，只受全局缩放影响，与单选未缩放图层保持一致）
      if (cornerHandles.size() == 4) {
        float handleSize = borderLineWidth * s_handleSizeFactor;
        
        std::vector<tgfx::Point> corners = {
          tgfx::Point::Make(aabb.left, aabb.top),
          tgfx::Point::Make(aabb.right, aabb.top),
          tgfx::Point::Make(aabb.right, aabb.bottom),
          tgfx::Point::Make(aabb.left, aabb.bottom)
        };
        
        for (size_t i = 0; i < 4; ++i) {
          auto handleShape = std::static_pointer_cast<tgfx::ShapeLayer>(cornerHandles[i]);
          const auto& corner = corners[i];
          
          tgfx::Path path;
          path.addRect(tgfx::Rect::MakeXYWH(
            corner.x - handleSize/2,
            corner.y - handleSize/2,
            handleSize,
            handleSize
          ));
          handleShape->setPath(path);
          handleShape->setLineWidth(borderLineWidth);
          // AABB的角控制器也在世界坐标系，矩阵保持单位矩阵
          handleShape->setMatrix(tgfx::Matrix::I());
        }
      } else {
        // 数量不对，重建角控制器
        createCornerHandlesForAABB(aabb);
      }
    }
    
    lastUpdateZoom = zoom;
    lastUpdateOffsetX = offsetX;
    lastUpdateOffsetY = offsetY;
  }

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

  // 如果处于多选模式，不创建高亮图层，因为已经有多选边框了
  if (isMultiSelection) {
    // 清除可能存在的旧高亮图层，避免残留
    if (latestHighlightedLayer) {
      resetHighlightLayer();
    }
    // printf("[高亮C++] 多选模式 - 跳过高亮检测\n");
    return false;
  }

  auto layers = appHost->getLayersUnderPoint(x, y);
  
  if (layers.size() > 0) {
    // 先检查是否包含角控制器，如果包含则直接返回，不进行高亮
    for (auto it : layers) {
      const std::string& layerName = it->name();
      if (layerName == "__CORNER_HANDLE__") {
        return false;
      }
    }
    
    // 如果没有控制图层，按层级顺序选择最顶层的图层
    std::shared_ptr<tgfx::Layer> selectedLayer = nullptr;

    for (auto it : layers) {
      const std::string& layerName = it->name();
      // 跳过所有控制图层：角控制器、单选边框、多选边框、临时高亮
      if (layerName == "__CORNER_HANDLE__" || 
          layerName == "__SELECTION_BORDER__" || 
          layerName == "__MULTI_SELECTION_BORDER__" ||
          layerName == "__TEMP_HIGHLIGHT__") {
        continue;
      }
      
      // 如果这个图层与当前高亮的图层相同，尝试选择下一个图层（穿透效果）
      if (it == latestHighlightedLayer) {
        continue;
      }
      
      // 选择第一个（最顶层的）非控制图层且非当前高亮的图层
      selectedLayer = it;
      break;
    }

    // 如果没有找到任何有效图层，清除现有高亮
    if (!selectedLayer) {
      if (latestHighlightedLayer) {
        resetHighlightLayer();
      }
      return false;
    }

    auto layer = selectedLayer;

    // 如果没有找到有内容的图层，使用原来的遮罩逻辑
    auto selectedLayerType = layer->type();
    if (selectedLayerType == tgfx::LayerType::Layer) {
      for (auto it : layers) {
        if (it->mask() == layer) {
          layer = it;
          break;
        }
      }
    }

    // 信任 getLayersUnderPoint 的命中测试结果，不需要额外的边界验证
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);

    // 已经在前面的循环中处理了相同图层的情况，这里不需要再检查

    if (highLightLayerIndex >= 0) {
      if (latestHighlightedLayer &&
          highLightLayerIndex == latestHighlightedLayer->getChildIndex(layer)) {
        return false;
      }
    }
    
    // 清除旧的高亮（允许对选中的图层也进行高亮）
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
    // 同时考虑全局缩放(lastZoom)和图层变换矩阵
    // 正确提取缩放值，不受旋转影响
    float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                             globalMatrix.getSkewY() * globalMatrix.getSkewY());
    float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                             globalMatrix.getScaleY() * globalMatrix.getScaleY());
    float layerAvgScale = (scaleX + scaleY) / 2.0f;

    // 结合全局缩放和图层缩放计算最终的缩放比例
    float totalScale = layerAvgScale * lastZoom;
    float adjustedLineWidth =
        totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;

    highlightLayer->setLineWidth(adjustedLineWidth);
    // 收缩到路径内，避免在选中边框外侧微微露出
    highlightLayer->setStrokeAlign(tgfx::StrokeAlign::Inside);
    auto maskLayer = layer->mask();

    highlightLayer->setMatrix(globalMatrix);

    if (maskLayer != nullptr) {
      auto maskPath = tgfx::Path();
      maskPath.addRect(maskLayer->getBounds());
      highlightLayer->setPath(maskPath);
    }

    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      // 如果当前图层是选中的图层，将高亮放在选中效果之上，这样两个效果都可见
      if (latestSelectedLayer && latestSelectedLayer->parent() == rootLayer && layer == selectedTargetLayer) {
        int selIndex = rootLayer->getChildIndex(latestSelectedLayer);
        rootLayer->addChildAt(highlightLayer, selIndex + 1);
      } else if (latestSelectedLayer && latestSelectedLayer->parent() == rootLayer) {
        // 对于非选中图层，将高亮放在选中效果之下
        int selIndex = rootLayer->getChildIndex(latestSelectedLayer);
        rootLayer->addChildAt(highlightLayer, selIndex);
      } else {
        rootLayer->addChild(highlightLayer);
      }
      highLightLayerIndex = rootLayer->getChildIndex(highlightLayer);
    } else {
      auto parentLayer = layer->parent();
      auto index = parentLayer->getChildIndex(layer);
      parentLayer->addChildAt(highlightLayer, index + 1);
      highLightLayerIndex = parentLayer->getChildIndex(highlightLayer);
    }
    
    // 确保高亮图层始终可见，即使在选中状态下
    highlightLayer->setVisible(true);
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
    latestHighlightedLayer.reset();
    highLightLayerIndex = -1;
  }

  appHost->markDirty();
  return true;
}


bool TGFXBaseView::resetMoveLayers() {
  // 多选模式和单选模式都需要重置
  if (moveLayers.empty() && !isMultiSelection) {
    return false;
  }

  if (!appHost) {
    return false;
  }

  // 处理多选模式
  if (isMultiSelection && !selectedLayers.empty()) {
    // 重新显示选中框和角控制器
    if (latestSelectedLayer) {
      latestSelectedLayer->setVisible(true);
    }
    for (auto& handle : cornerHandles) {
      if (handle) {
        handle->setVisible(true);
      }
    }
    // 重新显示内部高亮
    for (auto& highlight : tempHighlightLayers) {
      if (highlight) {
        highlight->setVisible(true);
      }
    }
    
    // 标记移动结束
    isMoving = false;
    appHost->markDirty();
    return true;
  }

  // 处理单选模式（原有逻辑）
  // 移动结束后，重新显示并更新高亮和选中效果的位置
  if (latestHighlightedLayer && !moveLayers.empty()) {
    // 优先使用选中目标的全局矩阵；若无选中目标则回退到移动的首层
    auto targetLayer = selectedTargetLayer ? selectedTargetLayer : moveLayers[0];
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(targetLayer);
    latestHighlightedLayer->setMatrix(globalMatrix);
    latestHighlightedLayer->setVisible(true);
  }

  if (latestSelectedLayer && !moveLayers.empty()) {
    // 优先使用选中目标的全局矩阵；确保与角控制器一致
    auto targetLayer = selectedTargetLayer ? selectedTargetLayer : moveLayers[0];
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(targetLayer);
    latestSelectedLayer->setMatrix(globalMatrix);
    latestSelectedLayer->setVisible(true);

    // 角控制器基于 selectedTargetLayer 的原始边界与最新矩阵
    removeCornerHandles();
    if (selectedTargetLayer) {
      createCornerHandles(selectedTargetLayer);
    }
    for (auto& handle : cornerHandles) {
      handle->setVisible(true);
    }

    // 同步更新选中线宽，保证丝滑
    updateSelectedLineWidth();
  }

  moveLayers.clear();

  // 标记移动结束，允许重建并显示角控制器
  isMoving = false;

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::selectMoveLayer(float pointX, float pointY) {
  printf("\n========== [selectMoveLayer] 被调用 ==========\n");
  printf("[selectMoveLayer] 当前多选状态: %s\n", isMultiSelection ? "true" : "false");
  printf("[selectMoveLayer] 当前选中图层数: %zu\n", selectedLayers.size());
  printf("[selectMoveLayer] 点击坐标: (%.2f, %.2f)\n", pointX, pointY);
  
  if (!appHost) {
    printf("[selectMoveLayer] ❌ appHost 为空\n");
    printf("========== [selectMoveLayer] 结束 ==========\n\n");
    return false;
  }

  moveLayers.clear();

  // 【关键修复1】如果当前处于多选模式，优先检查是否在多选框AABB内
  if (isMultiSelection && !selectedLayers.empty()) {
    printf("\n[多选模式优先判断] 当前为多选模式\n");
    
    auto aabb = calculateAxisAlignedBoundingBox();
    printf("[多选模式优先判断] AABB范围：left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
           aabb.left, aabb.top, aabb.right, aabb.bottom);
    
    bool isInAABB = aabb.contains(pointX, pointY);
    printf("[多选模式优先判断] 点击是否在AABB内: %s\n", isInAABB ? "是" : "否");
    
    if (isInAABB) {
      // 【重要】点击在多选框内，这是拖拽行为，不改变选中状态
      printf("[多选模式优先判断] ✅ 点击在AABB内，这是拖拽行为\n");
      printf("[多选模式优先判断] 保持多选状态不变，允许拖拽移动\n");
      printf("========== [selectMoveLayer] 结束 ==========\n\n");
      // moveLayers保持为空，moveMultiSelection会处理移动逻辑
      return true;
    } else {
      // 点击在多选框外，这可能是单击切换选择的行为
      printf("[多选模式优先判断] ⚠️ 点击在AABB外，这可能是切换选择行为\n");
      printf("[多选模式优先判断] 继续执行图层检测...\n");
      // 继续往下执行，检测是否点击到其他图层
    }
  }

  // 复用高亮的选层策略：从命中列表挑真实内容层，排除叠加效果层
  auto layers = appHost->getLayersUnderPoint(pointX, pointY);
  printf("[selectMoveLayer] getLayersUnderPoint 返回 %zu 个图层\n", layers.size());
  
  if (layers.empty()) {
    printf("[selectMoveLayer] ❌ 没有检测到图层\n");
    
    // 【关键修复2】如果当前是多选模式且点击在AABB外的空白处，不做任何处理
    if (isMultiSelection) {
      printf("[selectMoveLayer] 多选模式下点击空白处，保持多选状态不变\n");
      printf("========== [selectMoveLayer] 结束 ==========\n\n");
      return false;
    }
    
    printf("========== [selectMoveLayer] 结束 ==========\n\n");
    return false;
  }

  std::shared_ptr<tgfx::Layer> picked = nullptr;

  // 统一使用层级顺序选择策略，与选中和高亮检测保持一致
  printf("[selectMoveLayer] 开始过滤图层，共 %zu 个\n", layers.size());
  int layerIdx = 0;
  for (auto it : layers) {
    const std::string& layerName = it->name();
    
    // 【详细诊断】输出图层的完整信息
    printf("[selectMoveLayer]   图层%d: '%s' (地址:%p)\n", layerIdx++, layerName.c_str(), (void*)it.get());
    printf("[selectMoveLayer]       图层类型: %d\n", static_cast<int>(it->type()));
    printf("[selectMoveLayer]       父图层: %p\n", (void*)(it->parent()));
    printf("[selectMoveLayer]       是否为 latestSelectedLayer: %s\n", (it == latestSelectedLayer) ? "是" : "否");
    
    // 【关键检查】如果名称为空，检查是否是实例匹配
    if (layerName.empty()) {
      printf("[selectMoveLayer]       ⚠️ 空名称图层！\n");
      printf("[selectMoveLayer]       是否为 latestSelectedLayer 实例: %s\n", 
             (it == latestSelectedLayer) ? "是" : "否");
      
      // 检查是否在角控制器列表中
      bool isCornerHandle = std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end();
      printf("[selectMoveLayer]       是否为角控制器实例: %s\n", isCornerHandle ? "是" : "否");
    }
    
    // 跳过所有控制图层：角控制器、单选边框、多选边框、临时高亮
    if (layerName == "__CORNER_HANDLE__" || 
        layerName == "__SELECTION_BORDER__" || 
        layerName == "__MULTI_SELECTION_BORDER__" ||
        layerName == "__TEMP_HIGHLIGHT__") {
      printf("[selectMoveLayer]     → 跳过：控制图层 '%s'\n", layerName.c_str());
      continue;
    }
    
    // 跳过当前选中边框和角控制器（使用实例比较）
    if (it == latestSelectedLayer) {
      printf("[selectMoveLayer]     → 跳过：当前选中边框 (地址匹配)\n");
      continue;
    }
    
    if (std::find(cornerHandles.begin(), cornerHandles.end(), it) != cornerHandles.end()) {
      printf("[selectMoveLayer]     → 跳过：角控制器 (地址匹配)\n");
      continue;
    }
    
    // 选择第一个（最顶层的）非控制图层
    printf("[selectMoveLayer]     ✅ 选中此图层作为 picked\n");
    picked = it;
    break;
  }
  
  printf("[selectMoveLayer] 过滤完成，picked: %s (地址:%p)\n", 
         picked ? picked->name().c_str() : "null",
         picked ? (void*)picked.get() : nullptr);

  // 【关键修复3】如果当前处于多选模式，检查点击的图层
  if (isMultiSelection && !selectedLayers.empty()) {
    printf("\n[多选模式图层检测] 进入多选模式图层检测分支\n");
    printf("[多选模式图层检测] picked 图层: %s\n", picked ? picked->name().c_str() : "null");
    
    if (!picked) {
      // 没有点击到有效图层，但前面已经判断过AABB，这里应该不会执行
      printf("[多选模式图层检测] ❌ 没有点击到有效图层\n");
      printf("========== [selectMoveLayer] 结束 ==========\n\n");
      return false;
    }
    
    printf("[多选模式图层检测] 点击到图层：'%s' (%p)\n", picked->name().c_str(), (void*)picked.get());
    
    // 点击到了具体图层，检查是否在多选列表中
    bool isInSelectedLayers = false;
    for (const auto& selectedLayer : selectedLayers) {
      if (selectedLayer == picked) {
        isInSelectedLayers = true;
        break;
      }
    }
    
    printf("[多选模式图层检测] 图层是否在多选列表中: %s\n", isInSelectedLayers ? "是" : "否");
    
    if (isInSelectedLayers) {
      // 【重要】点击的是多选列表中的图层，这是拖拽行为，不改变选中状态
      printf("[多选模式图层检测] ✅ 点击多选列表中的图层，这是拖拽行为\n");
      printf("[多选模式图层检测] 保持多选状态不变，允许拖拽移动\n");
      printf("========== [selectMoveLayer] 结束 ==========\n\n");
      // 不清除多选状态，moveLayers保持为空，moveMultiSelection会处理
      return true;
    } else {
      // 【重要】点击的是多选列表外的图层，这是单击切换选择行为
      printf("[多选模式图层检测] ⚠️ 点击多选列表外的图层，切换到单选\n");
      printf("[多选模式图层检测] 多选状态改变：true → false\n");
      
      // 清除多选状态
      resetSelectedLayer();
      
      // 创建单选效果
      auto selectionBorder = tgfx::ShapeLayer::Make();
      selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
      auto rectPath = tgfx::Path();
      rectPath.addRect(picked->getBounds(nullptr, true));
      if (picked->mask() != nullptr) {
        tgfx::Path maskPath;
        maskPath.addRect(picked->mask()->getBounds());
        selectionBorder->setPath(maskPath);
      } else {
        selectionBorder->setPath(rectPath);
      }
      selectionBorder->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204)));

      auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(picked);
      float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                               globalMatrix.getSkewY() * globalMatrix.getSkewY());
      float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                               globalMatrix.getScaleY() * globalMatrix.getScaleY());
      float layerAvgScale = (scaleX + scaleY) / 2.0f;
      float totalScale = layerAvgScale * lastZoom;
      float adjustedLineWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
      
      selectionBorder->setLineWidth(adjustedLineWidth);
      selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
      selectionBorder->setMatrix(globalMatrix);
      selectionBorder->setName("__SELECTION_BORDER__");

      auto rootLayer = appHost->displayList.root();
      if (rootLayer) {
        rootLayer->addChild(selectionBorder);
      }

      latestSelectedLayer = selectionBorder;
      selectedTargetLayer = picked;

      // 创建四个角控制器
      createCornerHandles(picked);
      
      appHost->markDirty();
      printf("========== [selectMoveLayer] 结束 ==========\n\n");
      
      // 【重要】返回false，因为这不是拖拽行为，是切换选择
      return false;
    }
  }

  // 单选模式：没有点击到图层则返回失败
  if (!picked && !isMultiSelection) {
    printf("[selectMoveLayer] 单选模式下没有点击到图层，返回 false\n");
    printf("========== [selectMoveLayer] 结束 ==========\n\n");
    return false;
  }

  // 将遮罩相关的层一起加入（保持原逻辑）
  if (picked) {
    for (auto it : layers) {
      if (it->mask() == picked) {
        moveLayers.push_back(it);
      }
    }
    moveLayers.push_back(picked);
    printf("[selectMoveLayer] 添加 picked 图层到 moveLayers，当前 moveLayers 数量: %zu\n", moveLayers.size());
  }
  
  printf("[selectMoveLayer] 返回 true，准备移动\n");
  printf("========== [selectMoveLayer] 结束 ==========\n\n");
  return true;
}

void TGFXBaseView::moveHighlightLayer(float deltaX, float deltaY) {
  printf("\n========== [moveHighlightLayer] 被调用 ==========\n");
  printf("[moveHighlightLayer] 增量: (%.2f, %.2f)\n", deltaX, deltaY);
  printf("[moveHighlightLayer] 当前多选状态: %s\n", isMultiSelection ? "true" : "false");
  printf("[moveHighlightLayer] 当前 selectedLayers 数量: %zu\n", selectedLayers.size());
  printf("[moveHighlightLayer] 当前 moveLayers 数量: %zu\n", moveLayers.size());
  printf("[moveHighlightLayer] 当前 isMoving 状态: %s\n", isMoving ? "true" : "false");
  
  // 优先处理多选移动
  if (isMultiSelection && !selectedLayers.empty()) {
    printf("[moveHighlightLayer] ✅ 进入多选移动分支\n");
    printf("========== [moveHighlightLayer] 结束，调用 moveMultiSelection ==========\n\n");
    
    moveMultiSelection(deltaX, deltaY);
    return;
  }
  
  if (moveLayers.empty()) {
    printf("[moveHighlightLayer] ❌ moveLayers 为空，跳过移动\n");
    printf("========== [moveHighlightLayer] 结束 ==========\n\n");
    return;
  }
  
  printf("[moveHighlightLayer] 进入单选移动分支\n");

  // 标记进入移动状态，避免在移动过程中重建并显示角控制器
  isMoving = true;

  // 移动时隐藏高亮和选中效果
  if (latestHighlightedLayer) {
    latestHighlightedLayer->setVisible(false);
  }
  if (latestSelectedLayer) {
    latestSelectedLayer->setVisible(false);
    for (auto handle : cornerHandles) {
      handle->setVisible(false);
    }
  }

  for (auto moveLayer : moveLayers) {
    auto localDelta =
        CoordinateTransformer::screenDeltaToLayerDelta(deltaX, deltaY, lastZoom, moveLayer);

    auto matrix = moveLayer->matrix();
    matrix.preTranslate(localDelta.x, localDelta.y);
    moveLayer->setMatrix(matrix);
  }

  appHost->markDirty();
  printf("========== [moveHighlightLayer] 单选移动完成 ==========\n\n");
}

std::vector<float> TGFXBaseView::getMoveLayerPosition() {
  std::vector<float> position = {0.0f, 0.0f};

  if (!moveLayers.empty()) {
    auto matrix = moveLayers.at(0)->matrix();
    position[0] = matrix.getTranslateX();
    position[1] = matrix.getTranslateY();
  }

  return position;
}

std::vector<float> TGFXBaseView::getMoveLayerGlobalMatrix() {
  std::vector<float> matrixInfo = {1.0f, 1.0f, 0.0f, 0.0f};

  if (!moveLayers.empty()) {
    auto moveLayer = moveLayers.at(0);
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

// 旋转状态控制变量
static bool isRotationStart = true;
static int rotationCount = 0;

void TGFXBaseView::rotateSelectedLayer(float angle, float /*worldCenterX*/, float /*worldCenterY*/) {
  if (!selectedTargetLayer) {
    return;
  }

  rotationCount++;

  const float angleDegrees = angle * 180.0f / static_cast<float>(M_PI);
  
  // 只在开始旋转时输出详细信息
  if (isRotationStart) {
    printf("\n=== 旋转操作开始 ===\n");
    printf("[旋转] 图层: '%s'\n", selectedTargetLayer->name().c_str());
    
    // 获取当前总角度
    float currentRotation = getSelectedLayerRotation();
    float currentDegrees = currentRotation * 180.0f / static_cast<float>(M_PI);
    printf("[旋转] 当前角度: %.2f° (%.4f弧度)\n", currentDegrees, currentRotation);
    
    // 获取四个角坐标
    const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
    
    std::vector<tgfx::Point> corners = {
      tgfx::Point::Make(localBounds.left, localBounds.top),     // 左上角
      tgfx::Point::Make(localBounds.right, localBounds.top),    // 右上角  
      tgfx::Point::Make(localBounds.right, localBounds.bottom), // 右下角
      tgfx::Point::Make(localBounds.left, localBounds.bottom),  // 左下角
    };
    
    printf("[旋转] 四个角坐标 (考虑翻转状态):\n");
    const char* originalNames[] = {"左上角", "右上角", "右下角", "左下角"};
    for (size_t i = 0; i < corners.size(); ++i) {
      tgfx::Point worldPoint;
      globalMatrix.mapXY(corners[i].x, corners[i].y, &worldPoint);
      std::string actualCornerName = getActualCornerName(static_cast<int>(i));
      
      // 如果实际名称与原始名称不同，显示映射关系
      if (actualCornerName != originalNames[i]) {
        printf("  索引%zu: %s -> %s: 世界(%.2f, %.2f)\n", 
               i, originalNames[i], actualCornerName.c_str(), worldPoint.x, worldPoint.y);
      } else {
        printf("  索引%zu: %s: 世界(%.2f, %.2f)\n", 
               i, actualCornerName.c_str(), worldPoint.x, worldPoint.y);
      }
    }
    
    // 添加基于坐标位置的重新判断
    printf("[旋转] 基于坐标位置重新判断角名称:\n");
    for (size_t i = 0; i < corners.size(); ++i) {
      tgfx::Point worldPoint;
      globalMatrix.mapXY(corners[i].x, corners[i].y, &worldPoint);
      std::string positionBasedName = getCornerNameByPosition(static_cast<int>(i));
      printf("  %s(%zu): (%.2f, %.2f)\n", 
             positionBasedName.c_str(), i, worldPoint.x, worldPoint.y);
    }
    
    // 计算对角线
    tgfx::Point worldCorners[4];
    for (size_t i = 0; i < 4; ++i) {
      globalMatrix.mapXY(corners[i].x, corners[i].y, &worldCorners[i]);
    }
    printf("[旋转] 对角线:\n");
    printf("  对角线1: 左上(%.2f, %.2f) <-> 右下(%.2f, %.2f)\n", 
           worldCorners[0].x, worldCorners[0].y, worldCorners[2].x, worldCorners[2].y);
    printf("  对角线2: 右上(%.2f, %.2f) <-> 左下(%.2f, %.2f)\n", 
           worldCorners[1].x, worldCorners[1].y, worldCorners[3].x, worldCorners[3].y);
    
    // 检测翻转状态
    float scaleX = globalMatrix.getScaleX();
    float scaleY = globalMatrix.getScaleY();
    bool isFlippedX = scaleX < 0;
    bool isFlippedY = scaleY < 0;
    printf("[旋转] 翻转状态: X轴%s, Y轴%s\n", 
           isFlippedX ? "翻转" : "正常", isFlippedY ? "翻转" : "正常");
    
    isRotationStart = false;
  }

  // 获取本地几何中心
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  const tgfx::Point pivotLocal =
      tgfx::Point::Make((localBounds.left + localBounds.right) * 0.5f, 
                        (localBounds.top + localBounds.bottom) * 0.5f);

  // 直接在本地坐标系旋转，使用Matrix的preRotate(degrees, px, py)
  tgfx::Matrix newMatrix = selectedTargetLayer->matrix();
  newMatrix.preRotate(angleDegrees, pivotLocal.x, pivotLocal.y);
  selectedTargetLayer->setMatrix(newMatrix);

  updateCornerHandles();
  updateSelectedLineWidth();
  appHost->markDirty();
}

void TGFXBaseView::endRotation() {
  if (!selectedTargetLayer) {
    return;
  }
  
  // 重置旋转开始标志，以便下次旋转时重新输出开始信息
  isRotationStart = true;
  rotationCount = 0;
  
  printf("\n=== 旋转操作结束 ===\n");
  
  // 输出最终状态
  float finalRotation = getSelectedLayerRotation();
  float finalDegrees = finalRotation * 180.0f / static_cast<float>(M_PI);
  printf("[旋转] 最终角度: %.2f° (%.4f弧度)\n", finalDegrees, finalRotation);
  
  // 获取最终四个角坐标
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(localBounds.left, localBounds.top),
    tgfx::Point::Make(localBounds.right, localBounds.top),
    tgfx::Point::Make(localBounds.right, localBounds.bottom),
    tgfx::Point::Make(localBounds.left, localBounds.bottom),
  };
  
  printf("[旋转] 最终四个角坐标 (考虑翻转状态):\n");
  const char* originalNames[] = {"左上角", "右上角", "右下角", "左下角"};
  for (size_t i = 0; i < corners.size(); ++i) {
    tgfx::Point worldPoint;
    globalMatrix.mapXY(corners[i].x, corners[i].y, &worldPoint);
    std::string actualCornerName = getActualCornerName(static_cast<int>(i));
    
    // 如果实际名称与原始名称不同，显示映射关系
    if (actualCornerName != originalNames[i]) {
      printf("  索引%zu: %s -> %s: 世界(%.2f, %.2f)\n", 
             i, originalNames[i], actualCornerName.c_str(), worldPoint.x, worldPoint.y);
    } else {
      printf("  索引%zu: %s: 世界(%.2f, %.2f)\n", 
             i, actualCornerName.c_str(), worldPoint.x, worldPoint.y);
    }
  }
  
  // 计算最终对角线
  tgfx::Point worldCorners[4];
  for (size_t i = 0; i < 4; ++i) {
    globalMatrix.mapXY(corners[i].x, corners[i].y, &worldCorners[i]);
  }
  printf("[旋转] 最终对角线:\n");
  printf("  对角线1: 左上(%.2f, %.2f) <-> 右下(%.2f, %.2f)\n", 
         worldCorners[0].x, worldCorners[0].y, worldCorners[2].x, worldCorners[2].y);
  printf("  对角线2: 右上(%.2f, %.2f) <-> 左下(%.2f, %.2f)\n", 
         worldCorners[1].x, worldCorners[1].y, worldCorners[3].x, worldCorners[3].y);
  
  // 检测最终翻转状态
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  printf("[旋转] 最终翻转状态: X轴%s, Y轴%s\n", 
         isFlippedX ? "翻转" : "正常", isFlippedY ? "翻转" : "正常");
  
  // 添加图层树诊断输出
  printf("\n[图层树诊断] 旋转结束后的图层树结构:\n");
  auto rootLayer = appHost->displayList.root();
  if (rootLayer) {
    const auto& childrenList = rootLayer->children();
    printf("[图层树诊断] Root图层总共 %zu 个子图层\n", childrenList.size());
    
    for (size_t i = 0; i < childrenList.size(); i++) {
      auto child = childrenList[i];
      const char* layerType = "Unknown";
      
      // 使用 type() 方法判断图层类型
      auto type = child->type();
      if (type == tgfx::LayerType::Shape) {
        layerType = "ShapeLayer";
      } else if (type == tgfx::LayerType::Image) {
        layerType = "ImageLayer";
      } else if (type == tgfx::LayerType::Layer) {
        layerType = "Layer";
      }
      
      printf("[图层树诊断]   子图层%zu: '%s' (类型:%s, 地址:%p, visible:%s)\n", 
             i, child->name().c_str(), layerType, (void*)child.get(),
             child->visible() ? "true" : "false");
      
      // 输出矩阵信息
      auto matrix = child->matrix();
      printf("[图层树诊断]     矩阵: [%.4f, %.4f, %.4f, %.4f, %.4f, %.4f]\n",
             matrix.getScaleX(), matrix.getSkewX(), matrix.getSkewY(),
             matrix.getScaleY(), matrix.getTranslateX(), matrix.getTranslateY());
      
      // 如果是ShapeLayer，输出描边信息
      if (type == tgfx::LayerType::Shape) {
        auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(child);
        printf("[图层树诊断]     线宽: %.4f\n", shapeLayer->lineWidth());
      }
    }
    
    // 输出选中状态
    printf("[图层树诊断] latestSelectedLayer: %p ('%s')\n", 
           (void*)latestSelectedLayer.get(),
           latestSelectedLayer ? latestSelectedLayer->name().c_str() : "null");
    printf("[图层树诊断] selectedTargetLayer: %p ('%s')\n", 
           (void*)selectedTargetLayer.get(), 
           selectedTargetLayer ? selectedTargetLayer->name().c_str() : "null");
    
    // 输出角控制器状态
    printf("[图层树诊断] 角控制器数量: %zu\n", cornerHandles.size());
    for (size_t i = 0; i < cornerHandles.size(); i++) {
      if (cornerHandles[i]) {
        printf("[图层树诊断]   角控制器%zu: 地址=%p, 父图层=%s\n", 
               i, (void*)cornerHandles[i].get(),
               cornerHandles[i]->parent() ? "有" : "null");
      }
    }
  }
  printf("\n");
  
  printf("===================\n\n");
}

void TGFXBaseView::scaleSelectedLayer(float scaleX, float scaleY, float worldCenterX, float worldCenterY) {
  if (!selectedTargetLayer) {
    return;
  }

  // 将世界坐标的对角点转换为本地坐标
  tgfx::Point pivotWorld = tgfx::Point::Make(worldCenterX, worldCenterY);
  tgfx::Point pivotLocal = pivotWorld;
  
  // 如果有父层，需要计算父层的全局矩阵
  auto parentLayer = selectedTargetLayer->parent();
  tgfx::Matrix parentGlobalMatrix = tgfx::Matrix::I();
  if (parentLayer) {
    // 手动计算父层的全局矩阵
    auto tempLayer = parentLayer;
    while (tempLayer) {
      parentGlobalMatrix.preConcat(tempLayer->matrix());
      tempLayer = tempLayer->parent();
    }
  }
  
  // 计算从世界坐标到本地坐标的逆矩阵
  tgfx::Matrix worldToLocal = parentGlobalMatrix;
  if (!worldToLocal.invert(&worldToLocal)) {
    printf("[缩放C++] 警告：无法计算逆矩阵，使用本地几何中心\n");
    const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
    pivotLocal = tgfx::Point::Make((localBounds.left + localBounds.right) * 0.5f, 
                                    (localBounds.top + localBounds.bottom) * 0.5f);
  } else {
    // 将世界坐标的对角点转换为本地坐标
    worldToLocal.mapPoints(&pivotLocal, &pivotWorld, 1);
  }

  // 在本地坐标系缩放，使用对角点作为枢轴
  tgfx::Matrix newMatrix = selectedTargetLayer->matrix();
  newMatrix.preScale(scaleX, scaleY, pivotLocal.x, pivotLocal.y);
  selectedTargetLayer->setMatrix(newMatrix);

  updateCornerHandles();
  updateSelectedLineWidth();
  appHost->markDirty();
}

void TGFXBaseView::scaleSelectedLayerWithLocalPivot(float scaleX, float scaleY, float localPivotX, float localPivotY) {
  if (!selectedTargetLayer) {
    return;
  }

  // ========== 角控制器缩放诊断输出 ==========
  printf("\n========== [角控制器缩放] 开始 ==========\n");
  printf("[输入参数] 缩放因子: (%.6f, %.6f), 本地枢轴点: (%.2f, %.2f)\n", 
         scaleX, scaleY, localPivotX, localPivotY);
  
  // 输出缩放前的图层矩阵（完整的6个值）
  auto oldMatrix = selectedTargetLayer->matrix();
  printf("[缩放前] 选中图层矩阵: [%.6f, %.6f, %.2f]\n", 
         oldMatrix.getScaleX(), oldMatrix.getSkewY(), oldMatrix.getTranslateX());
  printf("                      [%.6f, %.6f, %.2f]\n", 
         oldMatrix.getSkewX(), oldMatrix.getScaleY(), oldMatrix.getTranslateY());
  
  // 输出图层的世界坐标边界
  auto root = selectedTargetLayer->root();
  auto worldBounds = selectedTargetLayer->getBounds(root, true);
  printf("[缩放前] 世界坐标边界: left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
         worldBounds.left, worldBounds.top, worldBounds.right, worldBounds.bottom);

  // 执行缩放
  tgfx::Matrix newMatrix = selectedTargetLayer->matrix();
  newMatrix.preScale(scaleX, scaleY, localPivotX, localPivotY);
  selectedTargetLayer->setMatrix(newMatrix);

  // 输出缩放后的图层矩阵（完整的6个值）
  printf("[缩放后] 选中图层矩阵: [%.6f, %.6f, %.2f]\n", 
         newMatrix.getScaleX(), newMatrix.getSkewY(), newMatrix.getTranslateX());
  printf("                      [%.6f, %.6f, %.2f]\n", 
         newMatrix.getSkewX(), newMatrix.getScaleY(), newMatrix.getTranslateY());
  
  // 输出缩放后的世界坐标边界
  auto worldBoundsAfter = selectedTargetLayer->getBounds(root, true);
  printf("[缩放后] 世界坐标边界: left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
         worldBoundsAfter.left, worldBoundsAfter.top, worldBoundsAfter.right, worldBoundsAfter.bottom);
  
  printf("========== [角控制器缩放] 结束 ==========\n\n");

  updateCornerHandles();
  updateSelectedLineWidth();
  appHost->markDirty();
}

std::vector<float> TGFXBaseView::getSelectedLayerCenter() {
  printf("[旋转C++] getSelectedLayerCenter 被调用\n");
  std::vector<float> center = {0.0f, 0.0f};
  
  // 优先检查多选模式
  if (isMultiSelection && !selectedLayers.empty()) {
    printf("[旋转C++] 多选模式，计算AABB中心点\n");
    auto aabb = calculateAxisAlignedBoundingBox();
    center[0] = aabb.centerX();
    center[1] = aabb.centerY();
    printf("[旋转C++] 多选AABB中心点：(%.2f, %.2f)\n", center[0], center[1]);
    return center;
  }
  
  // 单选模式
  if (!selectedTargetLayer) {
    printf("[旋转C++] 错误：没有选中的图层\n");
    return center;
  }
  
  // 获取图层在本地坐标系的边界
  auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  printf("[旋转C++] 本地边界：left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
         localBounds.left, localBounds.top, localBounds.right, localBounds.bottom);
  
  // 获取图层在世界坐标系（root）的边界
  auto root = selectedTargetLayer->root();
  auto worldBounds = selectedTargetLayer->getBounds(root, true);
  printf("[旋转C++] 世界边界：left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n",
         worldBounds.left, worldBounds.top, worldBounds.right, worldBounds.bottom);
  
  // 直接用世界边界计算中心点
  center[0] = worldBounds.centerX();
  center[1] = worldBounds.centerY();
  
  printf("[旋转C++] 选中图层 '%s' 的世界坐标中心点：(%.2f, %.2f)\n", 
         selectedTargetLayer->name().c_str(), center[0], center[1]);
  
  return center;
}

std::vector<std::string> TGFXBaseView::getSelectedLayerInfo() {
  std::vector<std::string> info;
  
  if (!selectedTargetLayer) {
    info.push_back("无选中图层");
    return info;
  }
  
  // 获取图层名称
  std::string layerName = selectedTargetLayer->name();
  if (layerName.empty()) {
    layerName = "未命名图层";
  }
  info.push_back(layerName);
  
  // 获取图层类型
  auto layerType = selectedTargetLayer->type();
  std::string typeStr = "Unknown";
  switch(layerType) {
    case tgfx::LayerType::Image: typeStr = "Image"; break;
    case tgfx::LayerType::Shape: typeStr = "Shape"; break;
    case tgfx::LayerType::Text: typeStr = "Text"; break;
    default: typeStr = "Other"; break;
  }
  info.push_back(typeStr);
  
  printf("[选中图层] 名称：'%s'，类型：%s\n", layerName.c_str(), typeStr.c_str());
  
  return info;
}

float TGFXBaseView::getSelectedLayerRotation() {
  if (!selectedTargetLayer) {
    return 0.0f;
  }
  
  // 获取图层的全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  float rawAngle = std::atan2(globalMatrix.getSkewY(), globalMatrix.getScaleX());
  
  float flipScaleX = globalMatrix.getScaleX() < 0 ? -1.0f : 1.0f;
  float flipScaleY = globalMatrix.getScaleY() < 0 ? -1.0f : 1.0f;
  float angle = rawAngle;
  if (flipScaleX * flipScaleY < 0) {
    angle = -angle;
  }
  
  printf("[旋转角度] 选中图层旋转角度：%.2f 弧度 (%.2f 度)\n", angle, angle * 180.0f / M_PI);
  
  return angle;
}

bool TGFXBaseView::selectLayerAndCheckRedraw(float x, float y) {
  if (!appHost) {
    return false;
  }
  
  // 移动状态下禁用选中检测，避免事件冲突
  if (isMoving) {
    return false;
  }

  auto layers = appHost->getLayersUnderPoint(x, y);
  
  // printf("[选中调试] 原始检测到 %zu 个图层，坐标(%.2f, %.2f)\n", layers.size(), x, y);
  auto rootLayer = appHost->displayList.root();
  // printf("[选中调试] 当前根图层地址: %p\n", (void*)rootLayer);
  
  // ========== 新增：如果当前是多选模式，清空多选状态 ==========
  if (isMultiSelection) {
    // printf("[选中调试] 退出多选模式，进入单选模式\n");
    clearMultiSelection();
  }
  
  // 先输出原始图层信息
  /*
  for (size_t i = 0; i < layers.size(); i++) {
    auto layer = layers[i];
    const char* layerType = "Unknown";
    auto type = layer->type();
    if (type == tgfx::LayerType::Shape) {
      layerType = "ShapeLayer";
    } else if (type == tgfx::LayerType::Image) {
      layerType = "ImageLayer";
    } else if (type == tgfx::LayerType::Layer) {
      layerType = "Layer";
    }
    
    bool hasParent = (layer->parent() != nullptr);
    printf("[选中调试]   原始图层%zu: '%s' (类型:%s, 父图层:%s, 地址:%p)\n", 
           i, layer->name().c_str(), layerType, 
           hasParent ? (layer->parent()->name().empty() ? "root" : layer->parent()->name().c_str()) : "null",
           (void*)layer.get());
  }
  */
  
  // 过滤掉根图层和父图层为null的异常图层
  std::vector<std::shared_ptr<tgfx::Layer>> validLayers;
  // int filteredCount = 0;
  
  for (auto layer : layers) {
    bool isRootLayer = (layer.get() == rootLayer);
    bool hasValidParent = (layer->parent() != nullptr);
    
    // 只保留有有效父图层的非根图层
    if (isRootLayer) {
      // filteredCount++;
      // printf("[选中调试] ⚠️ 过滤掉根图层: 地址=%p\n", (void*)layer.get());
    } else if (!hasValidParent) {
      // filteredCount++;
      // printf("[选中调试] ⚠️ 过滤掉异常图层（父图层为null）: '%s', 地址=%p\n", 
      //        layer->name().c_str(), (void*)layer.get());
    } else {
      validLayers.push_back(layer);
      // printf("[选中调试] ✅ 保留有效图层: '%s', 地址=%p\n", 
      //        layer->name().c_str(), (void*)layer.get());
    }
  }
  
  // printf("[选中调试] 过滤结果：原始%zu个 → 过滤掉%d个 → 剩余%zu个有效图层\n", 
  //        layers.size(), filteredCount, validLayers.size());
  
  layers = validLayers;
  
  
  // 去重：移除重复的图层（相同地址的图层只保留第一个）
  std::vector<std::shared_ptr<tgfx::Layer>> uniqueLayers;
  std::unordered_set<tgfx::Layer*> seenPointers;
  
  for (auto layer : layers) {
    if (seenPointers.find(layer.get()) == seenPointers.end()) {
      uniqueLayers.push_back(layer);
      seenPointers.insert(layer.get());
    } else {
      // printf("[选中调试] ⚠️ 去重：移除重复图层 '%s' (地址:%p)\n", 
      //        layer->name().c_str(), (void*)layer.get());
    }
  }
  
  /*
  if (uniqueLayers.size() != layers.size()) {
    printf("[选中调试] 去重结果：%zu个 → %zu个唯一图层\n", 
           layers.size(), uniqueLayers.size());
  }
  */
  
  layers = uniqueLayers;

  // 前置判断：如果点击的是控制图层，需要区分边框和内部
  if (!layers.empty()) {
    const std::string& layerName = layers[0]->name();
    // printf("[DEBUG] selectLayerAndCheckRedraw: 第一个图层名称: '%s'\n", layerName.c_str());
    
    if (layerName == "__CORNER_HANDLE__" || 
        layerName == "__SELECTION_BORDER__" || 
        layerName == "__MULTI_SELECTION_BORDER__" ||
        layerName == "__TEMP_HIGHLIGHT__") {
      // printf("[DEBUG] selectLayerAndCheckRedraw: 检测到控制图层: %s\n", layerName.c_str());
      
      // 对于角控制器，直接返回，不进行穿透（角控制器本身就是操作区域）
      if (layerName == "__CORNER_HANDLE__") {
        // printf("[DEBUG] selectLayerAndCheckRedraw: 点击角控制器，停止检测\n");
        return false;
      }
      
      // 对于选择边框，直接穿透到下层图层
      if (layerName == "__SELECTION_BORDER__") {
        // printf("[DEBUG] selectLayerAndCheckRedraw: 检测到选择边框，穿透检测下层图层\n");
        // 移除选择边框，继续检测下层图层
        layers.erase(layers.begin());
        // printf("[DEBUG] selectLayerAndCheckRedraw: 移除选择边框后剩余 %zu 个图层\n", layers.size());
      }
    }
  }

  // 按层级顺序选择图层，支持穿透选择（与高亮逻辑保持一致）
  std::shared_ptr<tgfx::Layer> bestLayer = nullptr;
  // printf("[选中调试] 开始遍历 %zu 个有效图层\n", layers.size());
  
  for (size_t i = 0; i < layers.size(); i++) {
    auto layer = layers[i];
    const std::string& layerName = layer->name();
    
    // printf("[选中调试]   检查图层%zu: '%s' (地址:%p)\n", i, layerName.c_str(), (void*)layer.get());
    
    // 跳过所有控制图层：角控制器、单选边框、多选边框、临时高亮
    if (layerName == "__CORNER_HANDLE__" || 
        layerName == "__SELECTION_BORDER__" || 
        layerName == "__MULTI_SELECTION_BORDER__" ||
        layerName == "__TEMP_HIGHLIGHT__") {
      // printf("[选中调试]     → 跳过：控制图层\n");
      continue;
    }
    
    // 选择第一个（最顶层的）非控制图层
    // 注意：不跳过已选中的图层，这样可以避免选中框在旋转后频繁切换
    bestLayer = layer;
    // printf("[选中调试]     ✅ 找到可选中的图层\n");
    break;
  }
  
  /*
  if (!bestLayer) {
    printf("[选中调试] ❌ 未找到可选中的图层\n");
  }
  */
  
  if (bestLayer) {
    // printf("[选中调试] ✅ 选中新图层: '%s' (地址:%p)\n", bestLayer->name().c_str(), (void*)bestLayer.get());

    // 先清理旧的选择框
    resetSelectedLayer();

    // 创建选中边框
    auto selectionBorder = tgfx::ShapeLayer::Make();
    selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
    auto rectPath = tgfx::Path();
    rectPath.addRect(bestLayer->getBounds(nullptr, true));
    if (bestLayer->mask() != nullptr) {
      tgfx::Path maskPath;
      maskPath.addRect(bestLayer->mask()->getBounds());
      selectionBorder->setPath(maskPath);
    } else {
      selectionBorder->setPath(rectPath);
    }
    selectionBorder->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204)));

    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(bestLayer);
    // 正确提取缩放值，不受旋转影响
    float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                             globalMatrix.getSkewY() * globalMatrix.getSkewY());
    float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                             globalMatrix.getScaleY() * globalMatrix.getScaleY());
    float layerAvgScale = (scaleX + scaleY) / 2.0f;
    float totalScale = layerAvgScale * lastZoom;
    float adjustedLineWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
    
    selectionBorder->setLineWidth(adjustedLineWidth);
    selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
    selectionBorder->setMatrix(globalMatrix);
    selectionBorder->setName("__SELECTION_BORDER__");

    // 添加到根图层
    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      rootLayer->addChild(selectionBorder);
    }

    latestSelectedLayer = selectionBorder;
    selectedTargetLayer = bestLayer;

    // 创建四个角控制器（createCornerHandles 内部已经添加到根图层）
    createCornerHandles(bestLayer);

  } else {
    // 点击空白处，清除选中
    resetSelectedLayer();
  }

  appHost->markDirty();
  return true;
}

bool TGFXBaseView::resetSelectedLayer() {
  // printf("[状态管理] 开始重置选中状态\n");
  
  bool hasChanges = false;
  
  // 1. 移除角控制器（先处理子元素）
  if (!cornerHandles.empty()) {
    removeCornerHandles();
    hasChanges = true;
  }
  
  // 2. 移除选中边框
  if (latestSelectedLayer) {
    // printf("[状态管理] 移除选中边框: 地址=%p\n", (void*)latestSelectedLayer.get());
    if (latestSelectedLayer->parent()) {
      latestSelectedLayer->removeFromParent();
    }
    latestSelectedLayer.reset();
    hasChanges = true;
  }
  
  // ⚠️ 关键修复：从根图层中移除所有名为 __SELECTION_BORDER__ 和 __MULTI_SELECTION_BORDER__ 的图层
  // 这是为了清理可能遗留的选中边框（防止重复添加导致的问题）
  if (appHost) {
    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      auto children = rootLayer->children();
      
      // 先收集需要移除的图层，避免遍历时修改集合导致迭代器失效
      std::vector<std::shared_ptr<tgfx::Layer>> toRemove;
      // int removedCount = 0;
      for (auto child : children) {
        if (child && (child->name() == "__SELECTION_BORDER__" || child->name() == "__MULTI_SELECTION_BORDER__")) {
          // printf("[状态管理]   ⚠️ 发现遗留的选中边框: %s, 地址=%p，标记移除\n", child->name().c_str(), (void*)child.get());
          toRemove.push_back(child);
          // removedCount++;
        }
      }
      
      // 再统一移除
      for (auto child : toRemove) {
        child->removeFromParent();
      }
      
      /*
      if (removedCount > 0) {
        printf("[状态管理]   清理了 %d 个遗留的选中边框\n", removedCount);
      }
      */
    }
  }
  
  // 3. 清理临时高亮层（多选模式的内部高亮）
  if (!tempHighlightLayers.empty()) {
    // printf("[状态管理] 清理 %zu 个临时高亮层\n", tempHighlightLayers.size());
    for (auto& highlight : tempHighlightLayers) {
      if (highlight && highlight->parent()) {
        highlight->removeFromParent();
      }
    }
    tempHighlightLayers.clear();
    hasChanges = true;
  }
  
  // 4. 清空多选图层列表
  if (!selectedLayers.empty()) {
    // printf("[状态管理] 清空多选图层列表（%zu 个图层）\n", selectedLayers.size());
    selectedLayers.clear();
    hasChanges = true;
  }
  
  // 5. 重置多选模式标志
  if (isMultiSelection) {
    // printf("[状态管理] 退出多选模式\n");
    isMultiSelection = false;
    hasChanges = true;
  }
  
  // 6. 清空目标引用
  if (selectedTargetLayer) {
    selectedTargetLayer.reset();
    hasChanges = true;
  }
  
  // 7. 重置相关状态（保持原有逻辑）
  if (isMoving) {
    isMoving = false;
    hasChanges = true;
  }
  
  // 8. 标记需要重绘
  if (hasChanges && appHost) {
    appHost->markDirty();
  }
  
  // printf("[状态管理] 选中状态重置完成，有变化：%s\n", hasChanges ? "是" : "否");
  return hasChanges;
}

void TGFXBaseView::createCornerHandles(std::shared_ptr<tgfx::Layer> layer) {
  if (!layer || !appHost) {
    return;
  }
  
  // 验证图层是否仍在图层树中
  if (!layer->parent() && layer.get() != appHost->displayList.root()) {
    return;
  }
  
  // 清除之前的角控制器
  removeCornerHandles();

  auto rootLayer = appHost->displayList.root();
  if (!rootLayer) {
    return;
  }

  // 使用CoordinateTransformer计算全局矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);

  // 角控制器大小与线宽按最简逻辑随缩放变化
  // 正确提取缩放值，不受旋转影响
  float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                           globalMatrix.getSkewY() * globalMatrix.getSkewY());
  float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                           globalMatrix.getScaleY() * globalMatrix.getScaleY());
  float layerAvgScale = (scaleX + scaleY) / 2.0f;
  float totalScale = layerAvgScale * lastZoom;
  float borderWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
  float handleSize = borderWidth * s_handleSizeFactor;

  // 使用原始图层边界
  auto b = layer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(b.left,  b.top),
    tgfx::Point::Make(b.right, b.top),
    tgfx::Point::Make(b.right, b.bottom),
    tgfx::Point::Make(b.left,  b.bottom),
  };
  
  for (size_t i = 0; i < corners.size(); ++i) {
    const auto& c = corners[i];
    auto handle = tgfx::ShapeLayer::Make();
    handle->setBlendMode(tgfx::BlendMode::SrcOver);

    tgfx::Path path;
    path.addRect(tgfx::Rect::MakeXYWH(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize));
    handle->setPath(path);

    handle->setFillStyle(tgfx::SolidColor::Make(tgfx::Color::White()));
    handle->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41)));
    handle->setLineWidth(borderWidth);
    handle->setStrokeAlign(tgfx::StrokeAlign::Outside);
    handle->setMatrix(globalMatrix);
    
    // 设置角控制器名称标识
    handle->setName("__CORNER_HANDLE__");

    rootLayer->addChild(handle);
    // 将 ShapeLayer 转换为 Layer 存储在 cornerHandles 中
    cornerHandles.push_back(std::static_pointer_cast<tgfx::Layer>(handle));
  }
}

void TGFXBaseView::removeCornerHandles() {
  printf("[角控制器清理] 开始清理，当前记录了 %zu 个角控制器\
", cornerHandles.size());
  
  // 先从父节点移除，再清理引用
  for (auto& handle : cornerHandles) {
    if (handle) {
      printf("[角控制器清理]   移除角控制器: 地址=%p, 有父图层=%s\
", 
             (void*)handle.get(), handle->parent() ? "是" : "否");
      // 检查父节点是否存在，避免重复移除
      if (handle->parent()) {
        handle->removeFromParent();
      }
      // 显式重置智能指针，确保引用计数正确递减
      handle.reset();
    }
  }
  
  // 清空容器并释放内存
  cornerHandles.clear();
  cornerHandles.shrink_to_fit();
  
  // ⚠️ 关键修复：从根图层中移除所有名为 __CORNER_HANDLE__ 的图层
  // 这是为了清理可能遗留的角控制器（防止重复添加导致的问题）
  if (appHost) {
    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      auto children = rootLayer->children();
      printf("[角控制器清理]   根图层当前有 %zu 个子图层\
", children.size());
      int removedCount = 0;
      for (auto child : children) {
        if (child && child->name() == "__CORNER_HANDLE__") {
          printf("[角控制器清理]   ⚠️ 发现遗留的角控制器: 地址=%p，正在移除\
", (void*)child.get());
          child->removeFromParent();
          removedCount++;
        }
      }
      if (removedCount > 0) {
        printf("[角控制器清理]   清理了 %d 个遗留的角控制器\
", removedCount);
      }
    }
  }
  
  printf("[角控制器清理] 清理完成\
");
}

void TGFXBaseView::updateCornerHandles() {
  // 移动中不更新（保持隐藏）；无选中目标不更新
  if (!appHost || !selectedTargetLayer || isMoving) {
    return;
  }

  // 依据当前缩放与矩阵计算线宽与大小
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  // 正确提取缩放值，不受旋转影响
  float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                           globalMatrix.getSkewY() * globalMatrix.getSkewY());
  float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                           globalMatrix.getScaleY() * globalMatrix.getScaleY());
  float layerAvgScale = (scaleX + scaleY) / 2.0f;
  float totalScale = layerAvgScale * lastZoom;
  float borderWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
  float handleSize = borderWidth * s_handleSizeFactor;

  // 原始内容边界用于计算角点（在本地坐标系）
  auto b = selectedTargetLayer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
      tgfx::Point::Make(b.left, b.top),
      tgfx::Point::Make(b.right, b.top),
      tgfx::Point::Make(b.right, b.bottom),
      tgfx::Point::Make(b.left, b.bottom),
  };

  // 若已有 4 个角控制器，则只更新其几何与线宽以实现丝滑；否则重建一次
  if (cornerHandles.size() == 4) {
    // 静默更新现有角控制器
    for (size_t i = 0; i < 4; ++i) {
      auto& handle = cornerHandles[i];
      if (!handle) {
        continue;
      }
      // 将 Layer 转换为 ShapeLayer 以调用 setPath 和 setLineWidth
      auto shapeHandle = std::static_pointer_cast<tgfx::ShapeLayer>(handle);
      const auto& c = corners[i];
      tgfx::Path path;
      path.addRect(tgfx::Rect::MakeXYWH(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize));
      shapeHandle->setPath(path);
      shapeHandle->setLineWidth(borderWidth);
      shapeHandle->setMatrix(globalMatrix);
      // 非移动状态下确保可见
      handle->setVisible(true);
    }
  } else {
    // 重建角控制器（减少日志输出）
    removeCornerHandles();
    createCornerHandles(selectedTargetLayer);
  }
}

void TGFXBaseView::updateSelectedLineWidth() {
  if (!appHost || !latestSelectedLayer || !selectedTargetLayer) {
    return;
  }
  // latestSelectedLayer 是 ShapeLayer
  auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestSelectedLayer);

  // 与角控制器一致：使用选中目标图层的全局矩阵计算缩放
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  // 正确提取缩放值，不受旋转影响
  float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                           globalMatrix.getSkewY() * globalMatrix.getSkewY());
  float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                           globalMatrix.getScaleY() * globalMatrix.getScaleY());
  float layerAvgScale = (scaleX + scaleY) / 2.0f;
  float totalScale = layerAvgScale * lastZoom;
  float adjustedLineWidth =
      totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;

  // 每帧同步几何路径为选中目标的原始内容边界，避免父子/遮罩导致的几何滞留
  tgfx::Path rectPath;
  rectPath.addRect(selectedTargetLayer->getBounds(nullptr, true));
  shapeLayer->setPath(rectPath);

  // 同步线宽和矩阵（位置），确保与目标图层保持一致
  shapeLayer->setMatrix(globalMatrix);
  shapeLayer->setLineWidth(adjustedLineWidth);
}

std::vector<float> TGFXBaseView::getSelectedLayerCorners() {
  std::vector<float> result;
  
  // 多选模式：返回AABB的4个角
  if (isMultiSelection && !selectedLayers.empty()) {
    auto aabb = calculateAxisAlignedBoundingBox();
    
    // 4个角的世界坐标（AABB是水平矩形）
    // ⚠️ 注意：返回世界坐标，不进行视口变换！
    result.reserve(8); // 4个角 * 2个坐标(x,y)
    result.push_back(aabb.left);    // 0: 左上角 X
    result.push_back(aabb.top);     // 0: 左上角 Y
    result.push_back(aabb.right);   // 1: 右上角 X
    result.push_back(aabb.top);     // 1: 右上角 Y
    result.push_back(aabb.right);   // 2: 右下角 X
    result.push_back(aabb.bottom);  // 2: 右下角 Y
    result.push_back(aabb.left);    // 3: 左下角 X
    result.push_back(aabb.bottom);  // 3: 左下角 Y
    
    // printf("[多选-角坐标] 返回AABB的4个角的世界坐标\n");
    return result;
  }
  
  // 单选模式：返回选中图层的4个角
  if (!selectedTargetLayer) {
    return result;
  }
  
  // 获取选中图层的边界
  auto bounds = selectedTargetLayer->getBounds(nullptr, true);
  
  // 计算4个角的本地坐标
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(bounds.left, bounds.top),     // 0: 左上角
    tgfx::Point::Make(bounds.right, bounds.top),    // 1: 右上角  
    tgfx::Point::Make(bounds.right, bounds.bottom), // 2: 右下角
    tgfx::Point::Make(bounds.left, bounds.bottom),  // 3: 左下角
  };
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 将角坐标转换到世界坐标系并存储
  // ⚠️ 注意：返回世界坐标，不应用视口变换！TypeScript端会自行转换为屏幕坐标
  result.reserve(8); // 4个角 * 2个坐标(x,y)
  for (const auto& corner : corners) {
    tgfx::Point worldPoint;
    globalMatrix.mapXY(corner.x, corner.y, &worldPoint);
    
    // 直接存储世界坐标（与多选模式保持一致）
    result.push_back(worldPoint.x);
    result.push_back(worldPoint.y);
  }
  
  return result;
}

std::vector<float> TGFXBaseView::getCornerHandlePosition(int cornerIndex) {
  std::vector<float> result;
  
  // 验证参数和状态
  if (cornerIndex < 0 || cornerIndex >= 4) {
    printf("[角控制器] getCornerHandlePosition 参数无效，索引：%d\n", cornerIndex);
    return result;
  }
  
  if (cornerHandles.size() != 4) {
    printf("[角控制器] getCornerHandlePosition 角控制器数量不正确：%zu\n", cornerHandles.size());
    return result;
  }
  
  auto& handle = cornerHandles[static_cast<size_t>(cornerIndex)];
  if (!handle) {
    printf("[角控制器] getCornerHandlePosition 角控制器%d为空\n", cornerIndex);
    return result;
  }
  
  // 获取角控制器的全局矩阵（已经是世界坐标系）
  auto matrix = handle->matrix();
  
  // 角控制器的中心点就是它的平移分量
  float worldX = matrix.getTranslateX();
  float worldY = matrix.getTranslateY();
  
  result.push_back(worldX);
  result.push_back(worldY);
  
  return result;
}

std::vector<float> TGFXBaseView::getSelectedLayerLocalCorner(int cornerIndex) {
  std::vector<float> result;
  
  if (!selectedTargetLayer) {
    printf("[本地坐标] getSelectedLayerLocalCorner 没有选中图层\n");
    return result;
  }
  
  if (cornerIndex < 0 || cornerIndex >= 4) {
    printf("[本地坐标] getSelectedLayerLocalCorner 参数无效，索引：%d\n", cornerIndex);
    return result;
  }
  
  // 获取图层的本地边界
  auto bounds = selectedTargetLayer->getBounds(nullptr, true);
  
  // 定义4个角的本地坐标
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(bounds.left, bounds.top),      // 0: 左上角
    tgfx::Point::Make(bounds.right, bounds.top),     // 1: 右上角
    tgfx::Point::Make(bounds.right, bounds.bottom),  // 2: 右下角
    tgfx::Point::Make(bounds.left, bounds.bottom),   // 3: 左下角
  };
  
  const auto& corner = corners[static_cast<size_t>(cornerIndex)];
  result.push_back(corner.x);
  result.push_back(corner.y);
  
  printf("[本地坐标] getSelectedLayerLocalCorner 索引%d，本地坐标：(%.2f, %.2f)\n", 
         cornerIndex, corner.x, corner.y);
  
  return result;
}

std::vector<float> TGFXBaseView::localToWorldCoords(float localX, float localY) {
  std::vector<float> result;
  
  if (!selectedTargetLayer) {
    printf("[坐标转换] localToWorldCoords 没有选中图层\n");
    return result;
  }
  
  // 获取图层的全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 将本地坐标转换为世界坐标
  tgfx::Point worldPoint;
  globalMatrix.mapXY(localX, localY, &worldPoint);
  
  result.push_back(worldPoint.x);
  result.push_back(worldPoint.y);
  
  printf("[坐标转换] localToWorldCoords 本地(%.2f, %.2f) -> 世界(%.2f, %.2f)\n", 
         localX, localY, worldPoint.x, worldPoint.y);
  
  return result;
}

std::string TGFXBaseView::getActualCornerName(int originalCornerIndex) {
  if (!selectedTargetLayer || originalCornerIndex < 0 || originalCornerIndex >= 4) {
    return "未知角";
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 检测翻转状态
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  
  // 原始角名称映射 (0=左上, 1=右上, 2=右下, 3=左下)
  const char* originalNames[] = {"左上角", "右上角", "右下角", "左下角"};
  
  // 根据翻转状态调整角的索引
  int actualIndex = originalCornerIndex;
  
  if (isFlippedX && !isFlippedY) {
    // 只有X轴翻转：左右互换
    switch (originalCornerIndex) {
      case 0: actualIndex = 1; break; // 左上 -> 右上
      case 1: actualIndex = 0; break; // 右上 -> 左上
      case 2: actualIndex = 3; break; // 右下 -> 左下
      case 3: actualIndex = 2; break; // 左下 -> 右下
    }
  } else if (!isFlippedX && isFlippedY) {
    // 只有Y轴翻转：上下互换
    switch (originalCornerIndex) {
      case 0: actualIndex = 3; break; // 左上 -> 左下
      case 1: actualIndex = 2; break; // 右上 -> 右下
      case 2: actualIndex = 1; break; // 右下 -> 右上
      case 3: actualIndex = 0; break; // 左下 -> 左上
    }
  } else if (isFlippedX && isFlippedY) {
    // 两轴都翻转：对角互换
    switch (originalCornerIndex) {
      case 0: actualIndex = 2; break; // 左上 -> 右下
      case 1: actualIndex = 3; break; // 右上 -> 左下
      case 2: actualIndex = 0; break; // 右下 -> 左上
      case 3: actualIndex = 1; break; // 左下 -> 右上
    }
  }
  // 如果没有翻转，actualIndex 保持原值
  
  return std::string(originalNames[actualIndex]);
}

std::string TGFXBaseView::getCornerNameByPosition(int cornerIndex) {
  if (!selectedTargetLayer || cornerIndex < 0 || cornerIndex >= 4) {
    return "未知角";
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 获取所有角的世界坐标
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(localBounds.left, localBounds.top),    // 0: 原始左上
    tgfx::Point::Make(localBounds.right, localBounds.top),   // 1: 原始右上
    tgfx::Point::Make(localBounds.right, localBounds.bottom), // 2: 原始右下
    tgfx::Point::Make(localBounds.left, localBounds.bottom),  // 3: 原始左下
  };
  
  // 转换所有角到世界坐标
  std::vector<tgfx::Point> worldCorners(4);
  for (size_t i = 0; i < 4; ++i) {
    globalMatrix.mapXY(corners[i].x, corners[i].y, &worldCorners[i]);
  }
  
  // 获取当前角的世界坐标
  tgfx::Point currentCorner = worldCorners[static_cast<size_t>(cornerIndex)];
  
  // 找到最左、最右、最上、最下的坐标值
  float minX = worldCorners[0].x, maxX = worldCorners[0].x;
  float minY = worldCorners[0].y, maxY = worldCorners[0].y;
  
  for (size_t i = 1; i < 4; ++i) {
    minX = std::min(minX, worldCorners[i].x);
    maxX = std::max(maxX, worldCorners[i].x);
    minY = std::min(minY, worldCorners[i].y);
    maxY = std::max(maxY, worldCorners[i].y);
  }
  
  // 根据当前角的位置判断它在哪个象限
  bool isLeft = std::abs(currentCorner.x - minX) < std::abs(currentCorner.x - maxX);
  bool isTop = std::abs(currentCorner.y - minY) < std::abs(currentCorner.y - maxY);
  
  // 根据位置返回角名称
  if (isLeft && isTop) {
    return "左上角";
  } else if (!isLeft && isTop) {
    return "右上角";
  } else if (!isLeft && !isTop) {
    return "右下角";
  } else {
    return "左下角";
  }
}

std::vector<std::string> TGFXBaseView::getCornerDetailInfo() {
  std::vector<std::string> result;
  
  if (!selectedTargetLayer) {
    return result;
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 检测翻转状态
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  
  // 构建翻转状态字符串
  std::string flipStatus = "X轴" + std::string(isFlippedX ? "翻转" : "正常") + 
                          ",Y轴" + std::string(isFlippedY ? "翻转" : "正常");
  
  // 获取角坐标
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(localBounds.left, localBounds.top),
    tgfx::Point::Make(localBounds.right, localBounds.top),
    tgfx::Point::Make(localBounds.right, localBounds.bottom),
    tgfx::Point::Make(localBounds.left, localBounds.bottom),
  };
  
  const char* originalNames[] = {"左上角", "右上角", "右下角", "左下角"};
  
  // 为每个角生成详细信息
  for (size_t i = 0; i < 4; ++i) {
    tgfx::Point worldPoint;
    globalMatrix.mapXY(corners[i].x, corners[i].y, &worldPoint);
    
    std::string actualName = getActualCornerName(static_cast<int>(i));
    
    // 格式：索引|原始名称|实际名称|世界X|世界Y|翻转状态
    std::string info = std::to_string(i) + "|" + 
                      originalNames[i] + "|" + 
                      actualName + "|" + 
                      std::to_string(worldPoint.x) + "|" + 
                      std::to_string(worldPoint.y) + "|" + 
                      flipStatus;
    result.push_back(info);
  }
  
  return result;
}

void TGFXBaseView::debugFlipStatus() {
  if (!selectedTargetLayer) {
    printf("[调试] 没有选中的图层\n");
    return;
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 检测翻转状态
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  
  printf("\n=== 翻转状态调试信息 ===\n");
  printf("[调试] 图层: '%s'\n", selectedTargetLayer->name().c_str());
  printf("[调试] 变换矩阵: [%.3f, %.3f, %.3f, %.3f, %.3f, %.3f]\n",
         globalMatrix.getScaleX(), globalMatrix.getSkewY(), globalMatrix.getSkewX(),
         globalMatrix.getScaleY(), globalMatrix.getTranslateX(), globalMatrix.getTranslateY());
  printf("[调试] 缩放值: scaleX=%.3f, scaleY=%.3f\n", scaleX, scaleY);
  printf("[调试] 翻转状态: X轴%s, Y轴%s\n", 
         isFlippedX ? "翻转" : "正常", isFlippedY ? "翻转" : "正常");
  
  printf("[调试] 角映射关系:\n");
  const char* originalNames[] = {"左上角", "右上角", "右下角", "左下角"};
  for (size_t i = 0; i < 4; ++i) {
    std::string actualName = getActualCornerName(static_cast<int>(i));
    if (actualName != originalNames[i]) {
      printf("  索引%zu: %s -> %s (已映射)\n", i, originalNames[i], actualName.c_str());
    } else {
      printf("  索引%zu: %s (未变化)\n", i, originalNames[i]);
    }
  }
  printf("========================\n\n");
}

int TGFXBaseView::getOppositeCornerIndex(int cornerIndex) {
  if (!selectedTargetLayer || cornerIndex < 0 || cornerIndex >= 4) {
    return -1;
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 检测翻转状态
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  
  // 在没有翻转的情况下，对角点的映射关系：
  // 0(左上) <-> 2(右下)
  // 1(右上) <-> 3(左下)
  int oppositeIndex;
  
  if (!isFlippedX && !isFlippedY) {
    // 没有翻转：标准对角关系
    oppositeIndex = (cornerIndex + 2) % 4;
  } else if (isFlippedX && !isFlippedY) {
    // 只有X轴翻转：左右互换，但对角关系保持
    // 原始: 0<->2, 1<->3
    // X翻转后: 1<->3, 0<->2 (实际位置变了，但索引对角关系不变)
    oppositeIndex = (cornerIndex + 2) % 4;
  } else if (!isFlippedX && isFlippedY) {
    // 只有Y轴翻转：上下互换，但对角关系保持
    oppositeIndex = (cornerIndex + 2) % 4;
  } else {
    // 两轴都翻转：对角关系保持
    oppositeIndex = (cornerIndex + 2) % 4;
  }
  
  return oppositeIndex;
}

std::vector<float> TGFXBaseView::getOppositeCornerWorldCoords(int cornerIndex) {
  std::vector<float> result;
  
  if (!selectedTargetLayer || cornerIndex < 0 || cornerIndex >= 4) {
    return result;
  }
  
  // 获取对角点索引
  int oppositeIndex = getOppositeCornerIndex(cornerIndex);
  if (oppositeIndex < 0) {
    return result;
  }
  
  // 获取图层边界和全局变换矩阵
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 定义四个角的本地坐标
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(localBounds.left, localBounds.top),     // 0: 左上角
    tgfx::Point::Make(localBounds.right, localBounds.top),    // 1: 右上角  
    tgfx::Point::Make(localBounds.right, localBounds.bottom), // 2: 右下角
    tgfx::Point::Make(localBounds.left, localBounds.bottom),  // 3: 左下角
  };
  
  // 获取对角点的本地坐标并转换为世界坐标
  const auto& oppositeCorner = corners[static_cast<size_t>(oppositeIndex)];
  tgfx::Point worldPoint;
  globalMatrix.mapXY(oppositeCorner.x, oppositeCorner.y, &worldPoint);
  
  result.push_back(worldPoint.x);
  result.push_back(worldPoint.y);
  
  printf("[对角点计算] 角%d的对角点是角%d，世界坐标：(%.2f, %.2f)\n", 
         cornerIndex, oppositeIndex, worldPoint.x, worldPoint.y);
  
  return result;
}

std::vector<float> TGFXBaseView::getSelectedLayerFlipState() {
  std::vector<float> result;
  
  if (!selectedTargetLayer) {
    return result; // 返回空数组
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 检测翻转状态（通过缩放值的正负判断）
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  
  // 返回翻转状态：[isFlippedX, isFlippedY]，用0/1表示
  result.push_back(isFlippedX ? 1.0f : 0.0f);
  result.push_back(isFlippedY ? 1.0f : 0.0f);
  
  return result;
}

int TGFXBaseView::getLocalIndexByVisualCornerName(const std::string& visualCornerName) {
  if (!selectedTargetLayer) {
    return -1;
  }
  
  // 获取全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 获取所有角的世界坐标
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(localBounds.left, localBounds.top),    // 0: 本地左上
    tgfx::Point::Make(localBounds.right, localBounds.top),   // 1: 本地右上
    tgfx::Point::Make(localBounds.right, localBounds.bottom), // 2: 本地右下
    tgfx::Point::Make(localBounds.left, localBounds.bottom),  // 3: 本地左下
  };
  
  // 转换所有角到世界坐标
  std::vector<tgfx::Point> worldCorners(4);
  for (size_t i = 0; i < 4; ++i) {
    globalMatrix.mapXY(corners[i].x, corners[i].y, &worldCorners[i]);
  }
  
  // 找到最左、最右、最上、最下的坐标值
  float minX = worldCorners[0].x, maxX = worldCorners[0].x;
  float minY = worldCorners[0].y, maxY = worldCorners[0].y;
  
  for (size_t i = 1; i < 4; ++i) {
    minX = std::min(minX, worldCorners[i].x);
    maxX = std::max(maxX, worldCorners[i].x);
    minY = std::min(minY, worldCorners[i].y);
    maxY = std::max(maxY, worldCorners[i].y);
  }
  
  // 遍历所有本地索引，找到视觉位置匹配的那个
  for (size_t i = 0; i < 4; ++i) {
    const auto& worldCorner = worldCorners[i];
    
    // 判断这个本地索引对应的世界坐标在哪个视觉位置
    bool isLeft = std::abs(worldCorner.x - minX) < std::abs(worldCorner.x - maxX);
    bool isTop = std::abs(worldCorner.y - minY) < std::abs(worldCorner.y - maxY);
    
    std::string currentVisualName;
    if (isLeft && isTop) {
      currentVisualName = "左上角";
    } else if (!isLeft && isTop) {
      currentVisualName = "右上角";
    } else if (!isLeft && !isTop) {
      currentVisualName = "右下角";
    } else {
      currentVisualName = "左下角";
    }
    
    // 如果视觉名称匹配，返回这个本地索引
    if (currentVisualName == visualCornerName) {
      printf("[视觉角映射] 视觉'%s' -> 本地索引%zu\n", visualCornerName.c_str(), i);
      return static_cast<int>(i);
    }
  }
  
  printf("[视觉角映射] 警告：未找到视觉角'%s'对应的本地索引\n", visualCornerName.c_str());
  return -1;
}

void TGFXBaseView::debugCornerAndOppositeInfo() {
  if (!selectedTargetLayer) {
    printf("[调试] 没有选中的图层\n");
    return;
  }
  
  printf("\n=== 角和对角点详细信息 ===\n");
  printf("[调试] 图层: '%s'\n", selectedTargetLayer->name().c_str());
  
  // 获取图层边界和全局变换矩阵
  const auto localBounds = selectedTargetLayer->getBounds(nullptr, true);
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 检测翻转状态
  float scaleX = globalMatrix.getScaleX();
  float scaleY = globalMatrix.getScaleY();
  bool isFlippedX = scaleX < 0;
  bool isFlippedY = scaleY < 0;
  printf("[调试] 翻转状态: X轴%s, Y轴%s\n", 
         isFlippedX ? "翻转" : "正常", isFlippedY ? "翻转" : "正常");
  
  // 定义四个角的本地坐标
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(localBounds.left, localBounds.top),     // 0: 左上角
    tgfx::Point::Make(localBounds.right, localBounds.top),    // 1: 右上角  
    tgfx::Point::Make(localBounds.right, localBounds.bottom), // 2: 右下角
    tgfx::Point::Make(localBounds.left, localBounds.bottom),  // 3: 左下角
  };
  
  const char* originalNames[] = {"左上角", "右上角", "右下角", "左下角"};
  
  printf("[调试] 所有角的信息:\n");
  for (size_t i = 0; i < 4; ++i) {
    // 当前角的世界坐标
    tgfx::Point worldPoint;
    globalMatrix.mapXY(corners[i].x, corners[i].y, &worldPoint);
    
    // 实际角名称（考虑翻转）
    std::string actualName = getActualCornerName(static_cast<int>(i));
    
    // 对角点信息
    int oppositeIndex = getOppositeCornerIndex(static_cast<int>(i));
    tgfx::Point oppositeWorldPoint;
    globalMatrix.mapXY(corners[static_cast<size_t>(oppositeIndex)].x, 
                      corners[static_cast<size_t>(oppositeIndex)].y, &oppositeWorldPoint);
    std::string oppositeActualName = getActualCornerName(oppositeIndex);
    
    printf("  角%zu: %s -> %s, 世界坐标(%.2f, %.2f)\n", 
           i, originalNames[i], actualName.c_str(), worldPoint.x, worldPoint.y);
    printf("    对角点: 角%d (%s -> %s), 世界坐标(%.2f, %.2f)\n", 
           oppositeIndex, originalNames[static_cast<size_t>(oppositeIndex)], 
           oppositeActualName.c_str(), oppositeWorldPoint.x, oppositeWorldPoint.y);
  }
  
  printf("============================\n\n");
}

void TGFXBaseView::setSelectionLineWidth(float width) {
  if (width > 0.0f) {
    s_highlightLineWidth = width;
    // 立即更新现有选中与高亮的线宽
    updateHighlightLineWidth();
    updateSelectedLineWidth();
    updateCornerHandles();
    markDirty();
  }
}

float TGFXBaseView::getSelectionLineWidth() const {
  return s_highlightLineWidth;
}

void TGFXBaseView::setHandleSizeFactor(float factor) {
  if (factor > 0.0f) {
    s_handleSizeFactor = factor;
    // 立即应用到角控制器
    updateCornerHandles();
    markDirty();
  }
}

float TGFXBaseView::getHandleSizeFactor() const {
  return s_handleSizeFactor;
}

void TGFXBaseView::markDirty() {
  if (appHost) {
    appHost->markDirty();
  }
}

void TGFXBaseView::onWheelEvent() {
  if (appHost) {
    // 仅标记脏区，实际更新在下一帧 draw(zoom, ...) 中按最新缩放统一执行
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

void TGFXBaseView::updateHighlightLineWidth() {
  if (!latestHighlightedLayer || !appHost) {
    return;
  }

  // 获取高亮图层，我们知道它是 ShapeLayer 类型（在 highlightLayerAndCheckRedraw 中创建）
  auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestHighlightedLayer);

  // 获取高亮图层的变换矩阵
  auto globalMatrix = latestHighlightedLayer->matrix();

  // 计算缩放比例，调整线宽以保持视觉一致性
  // 同时考虑全局缩放(lastZoom)和图层变换矩阵
  // 正确提取缩放值，不受旋转影响
  float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                           globalMatrix.getSkewY() * globalMatrix.getSkewY());
  float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                           globalMatrix.getScaleY() * globalMatrix.getScaleY());
  float layerAvgScale = (scaleX + scaleY) / 2.0f;

  // 结合全局缩放和图层缩放计算最终的缩放比例
  float totalScale = layerAvgScale * lastZoom;
  float adjustedLineWidth =
      totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;

  // 更新线宽
  shapeLayer->setLineWidth(adjustedLineWidth);
}

bool TGFXBaseView::validateSelectionState() {
  bool needsCleanup = false;
  
  // 检查选中目标图层是否仍然有效
  if (selectedTargetLayer) {
    // 检查图层是否还在图层树中
    if (!selectedTargetLayer->parent() && selectedTargetLayer.get() != appHost->displayList.root()) {
      printf("[状态验证] 选中目标图层已从图层树中移除，需要清理\n");
      needsCleanup = true;
    }
  }
  
  // 检查选中边框是否仍然有效
  if (latestSelectedLayer) {
    if (!latestSelectedLayer->parent()) {
      printf("[状态验证] 选中边框已失效\n");
      needsCleanup = true;
    }
  }
  
  // 检查角控制器是否仍然有效
  for (auto it = cornerHandles.begin(); it != cornerHandles.end();) {
    if (!(*it) || !(*it)->parent()) {
      if (*it) {
        (*it)->removeFromParent();
      }
      it = cornerHandles.erase(it);
      needsCleanup = true;
    } else {
      ++it;
    }
  }
  
  // 如果发现问题，执行清理
  if (needsCleanup) {
    resetSelectedLayer();
    return false;
  }
  
  return true;
}

// ===== 鼠标状态管理实现 =====

void TGFXBaseView::onMouseMove(float x, float y) {
  if (!mouseStateManager) return;
  
  // 更新鼠标状态
  mouseStateManager->updateMouseState(x, y, MouseEventType::Move);
  
  // 如果当前处于拖拽状态，执行移动操作
  MouseState currentState = mouseStateManager->getCurrentState();
  if (currentState == MouseState::Dragging && selectedTargetLayer) {
    // 计算移动增量（这里需要根据实际需求调整坐标转换）
    static float lastX = x, lastY = y;
    float deltaX = x - lastX;
    float deltaY = y - lastY;
    
    moveHighlightLayer(deltaX, deltaY);
    
    lastX = x;
    lastY = y;
  }
}

void TGFXBaseView::onMouseDown(float x, float y) {
  if (!mouseStateManager) return;
  
  // 更新鼠标状态
  mouseStateManager->updateMouseState(x, y, MouseEventType::Down);
  
  // 根据当前区域执行相应操作
  InteractionZone zone = detectMouseInteractionZone(x, y);
  
  switch (zone) {
    case InteractionZone::CornerHandle:
      printf("[鼠标事件] 开始角点调整\n");
      // TODO: 实现角点调整逻辑
      break;
      
    case InteractionZone::SelectionBorder:
      printf("[鼠标事件] 开始边框移动\n");
      // 已有的移动逻辑
      break;
      
    case InteractionZone::RotateZone:
      printf("[鼠标事件] 开始旋转操作\n");
      // TODO: 实现旋转逻辑
      break;
      
    case InteractionZone::Layer:
      printf("[鼠标事件] 选中图层\n");
      selectLayerAndCheckRedraw(x, y);
      break;
      
    case InteractionZone::Empty:
    default:
      printf("[鼠标事件] 点击空白区域\n");
      resetSelectedLayer();
      break;
  }
}

void TGFXBaseView::onMouseUp(float x, float y) {
  if (!mouseStateManager) return;
  
  // 更新鼠标状态
  mouseStateManager->updateMouseState(x, y, MouseEventType::Up);
  
  // 结束任何正在进行的操作
  MouseState currentState = mouseStateManager->getCurrentState();
  if (currentState == MouseState::Dragging || currentState == MouseState::Rotating) {
    printf("[鼠标事件] 结束拖拽/旋转操作\n");
  }
}

MouseState TGFXBaseView::getCurrentMouseState() const {
  if (!mouseStateManager) return MouseState::Idle;
  return mouseStateManager->getCurrentState();
}

void TGFXBaseView::resetMouseState() {
  if (mouseStateManager) {
    mouseStateManager->reset();
  }
}


InteractionZone TGFXBaseView::detectMouseInteractionZone(float x, float y) {
  // 优先级：角控制器 > 选中边框 > 旋转区域 > 图层 > 空白
  
  if (isPointInCornerHandle(x, y)) {
    return InteractionZone::CornerHandle;
  }
  
  if (isPointInSelectionBorder(x, y)) {
    return InteractionZone::SelectionBorder;
  }
  
  if (isPointInRotateZone(x, y)) {
    return InteractionZone::RotateZone;
  }
  
  // 检查是否在某个图层上
  std::vector<std::shared_ptr<tgfx::Layer>> allLayers;
  auto layer = selectBestLayerAtPoint(x, y, allLayers);
  if (layer) {
    return InteractionZone::Layer;
  }
  
  return InteractionZone::Empty;
}

bool TGFXBaseView::isPointInCornerHandle(float x, float y) {
  // 多选模式下也可以使用角控制器
  if (cornerHandles.empty()) return false;
  
  // 检查每个角控制器
  for (const auto& handle : cornerHandles) {
    if (!handle) continue;
    
    // 获取角控制器的边界
    auto bounds = handle->getBounds();
    auto matrix = getLayerGlobalMatrix(handle);
    
    // 将边界转换到全局坐标
    auto globalBounds = matrix.mapRect(bounds);
    
    // 检查点是否在边界内
    if (globalBounds.contains(x, y)) {
      return true;
    }
  }
  
  return false;
}

bool TGFXBaseView::isPointInSelectedLayer(float x, float y) {
  // 多选模式：检查点是否在任何一个选中图层内部
  if (isMultiSelection && !selectedLayers.empty()) {
    for (const auto& layer : selectedLayers) {
      if (!layer) continue;
      
      auto bounds = layer->getBounds();
      auto matrix = getLayerGlobalMatrix(layer);
      auto globalBounds = matrix.mapRect(bounds);
      
      if (globalBounds.contains(x, y)) {
        return true;  // 只要在任何一个图层内部就返回true
      }
    }
    return false;  // 不在任何选中图层内部
  }
  
  // 单选模式：检查单个选中图层
  if (!selectedTargetLayer) return false;
  
  // 获取选中图层的边界
  auto bounds = selectedTargetLayer->getBounds();
  auto matrix = getLayerGlobalMatrix(selectedTargetLayer);
  auto globalBounds = matrix.mapRect(bounds);
  
  // printf("[DEBUG] isPointInSelectedLayer: 点坐标 (%.2f, %.2f)\n", x, y);
  // printf("[DEBUG] isPointInSelectedLayer: 图层边界 left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n", 
  //        bounds.left, bounds.top, bounds.right, bounds.bottom);
  // printf("[DEBUG] isPointInSelectedLayer: 全局边界 left=%.2f, top=%.2f, right=%.2f, bottom=%.2f\n", 
  //        globalBounds.left, globalBounds.top, globalBounds.right, globalBounds.bottom);
  
  // // // 检查点是否在选中图层内部
  bool result = globalBounds.contains(x, y);
  // printf("[DEBUG] isPointInSelectedLayer: 结果 %s\n", result ? "在内部" : "不在内部");
  return result;
}

bool TGFXBaseView::isPointInSelectionBorder(float x, float y) {
  // 多选模式下，检查多选边框
  if (isMultiSelection && !selectedLayers.empty() && latestSelectedLayer) {
    // 使用多选边框进行检测
    auto bounds = calculateAxisAlignedBoundingBox();
    
    // 检查是否在边框附近（但不在内部）
    float lineWidth = s_highlightLineWidth / lastZoom;
    float tolerance = lineWidth * 2.0f;
    
    auto expandedBounds = bounds;
    expandedBounds.outset(tolerance, tolerance);
    
    return expandedBounds.contains(x, y) && !bounds.contains(x, y);
  }
  
  // 单选模式
  if (!selectedTargetLayer) return false;
  
  // 获取选中图层的边界
  auto bounds = selectedTargetLayer->getBounds();
  auto matrix = getLayerGlobalMatrix(selectedTargetLayer);
  auto globalBounds = matrix.mapRect(bounds);
  
  // 检查是否在边框附近（但不在内部）
  float lineWidth = calculateAdjustedLineWidth(selectedTargetLayer);
  float tolerance = lineWidth * 2.0f; // 边框检测容差
  
  // 扩展边界用于检测
  auto expandedBounds = globalBounds;
  expandedBounds.outset(tolerance, tolerance);
  
  // 点在扩展边界内但不在原始边界内
  return expandedBounds.contains(x, y) && !globalBounds.contains(x, y);
}

bool TGFXBaseView::isPointInRotateZone(float x, float y) {
  if (!selectedTargetLayer) return false;
  
  // 首先检查是否在角控制器上，如果是则不是旋转区域
  if (isPointInCornerHandle(x, y)) {
    return false;
  }
  
  // 旋转区域应该在角控制器外侧，但仍在选择框附近
  auto bounds = selectedTargetLayer->getBounds();
  auto matrix = getLayerGlobalMatrix(selectedTargetLayer);
  auto globalBounds = matrix.mapRect(bounds);
  
  // 角控制器通常在图层边界外8px处
  float cornerHandleDistance = 8.0f;
  float cornerHandleSize = 8.0f; // 角控制器的半径
  float rotateZoneWidth = 20.0f; // 旋转区域的宽度
  
  // 角控制器区域边界（图层边界向外扩展到角控制器外边缘）
  auto cornerZoneBounds = globalBounds;
  cornerZoneBounds.outset(cornerHandleDistance + cornerHandleSize, cornerHandleDistance + cornerHandleSize);
  
  // 旋转区域外边界（从角控制器区域继续向外扩展）
  auto rotateZoneOuterBounds = cornerZoneBounds;
  rotateZoneOuterBounds.outset(rotateZoneWidth, rotateZoneWidth);
  
  // 旋转区域 = 在外边界内 && 不在角控制器区域内 && 不在角控制器上
  return rotateZoneOuterBounds.contains(x, y) && !cornerZoneBounds.contains(x, y);
}


// 添加缺失的函数实现
tgfx::Matrix TGFXBaseView::getLayerGlobalMatrix(std::shared_ptr<tgfx::Layer> layer) {
  if (!layer) {
    return tgfx::Matrix::I();
  }
  
  // 获取图层的全局变换矩阵
  tgfx::Matrix matrix = tgfx::Matrix::I();
  auto currentLayer = layer;
  
  while (currentLayer) {
    matrix.preConcat(currentLayer->matrix());
    // parent()返回原始指针，需要特殊处理
    auto parentPtr = currentLayer->parent();
    if (parentPtr) {
      // 从根节点查找父图层的智能指针引用
      // 首先获取根图层的智能指针
      auto rootPtr = appHost->displayList.root();
      if (rootPtr) {
        // 创建根图层的智能指针（假设DisplayList有获取根图层智能指针的方法）
        // 这里我们需要简化处理，直接跳出循环
        currentLayer.reset();
      } else {
        currentLayer.reset();
      }
    } else {
      currentLayer.reset();
    }
  }
  
  return matrix;
}

float TGFXBaseView::calculateAdjustedLineWidth(std::shared_ptr<tgfx::Layer> layer) {
  if (!layer) {
    return 1.0f;
  }
  
  // 根据图层的变换矩阵计算调整后的线宽
  auto matrix = getLayerGlobalMatrix(layer);
  float scaleX = std::sqrt(matrix.getScaleX() * matrix.getScaleX() + matrix.getSkewY() * matrix.getSkewY());
  float scaleY = std::sqrt(matrix.getSkewX() * matrix.getSkewX() + matrix.getScaleY() * matrix.getScaleY());
  
  // 使用较小的缩放值来计算线宽，确保线条在缩放时保持合理的视觉效果
  float scale = std::min(scaleX, scaleY);
  return std::max(1.0f, 2.0f / scale); // 最小线宽为1像素
}

std::shared_ptr<tgfx::Layer> TGFXBaseView::selectBestLayerAtPoint(
    float /* x */, float /* y */, 
    const std::vector<std::shared_ptr<tgfx::Layer>>& excludeLayers) {
  
  if (excludeLayers.empty()) {
    return nullptr;
  }
  
  // 如果只有一个候选，直接返回
  if (excludeLayers.size() == 1) {
    return excludeLayers[0];
  }
  
  // 优先选择最小的图层（通常是最上层或最具体的图层）
  std::shared_ptr<tgfx::Layer> bestLayer = nullptr;
  float minArea = std::numeric_limits<float>::max();
  
  for (const auto& layer : excludeLayers) {
    if (!layer) continue;
    
    // 计算图层的边界框面积
    auto bounds = layer->getBounds();
    float area = bounds.width() * bounds.height();
    
    // 选择面积最小的图层
    if (area < minArea) {
      minArea = area;
      bestLayer = layer;
    }
  }
  
  return bestLayer ? bestLayer : excludeLayers[0];
}

std::shared_ptr<tgfx::Layer> TGFXBaseView::selectBestLayerAtPoint(float x, float y) {
  if (!appHost) {
    return nullptr;
  }
  
  auto layers = appHost->getLayersUnderPoint(x, y);
  return selectBestLayerAtPoint(x, y, layers);
}

// 辅助方法：在图层树中查找原始指针对应的智能指针
std::shared_ptr<tgfx::Layer> TGFXBaseView::findSharedPtrForLayer(std::shared_ptr<tgfx::Layer> root, tgfx::Layer* target) {
  if (!root || !target) {
    return nullptr;
  }
  
  // 如果当前节点就是目标
  if (root.get() == target) {
    return root;
  }
  
  // 递归搜索子节点
  const auto& children = root->children();
  for (const auto& child : children) {
    if (child) {
      auto result = findSharedPtrForLayer(child, target);
      if (result) {
        return result;
      }
    }
  }
  
  return nullptr;
}

// 检测点是否在控制图层的边框上
bool TGFXBaseView::isPointOnControlLayerBorder(float x, float y, std::shared_ptr<tgfx::Layer> controlLayer) {
  if (!controlLayer) {
    // printf("[DEBUG] isPointOnControlLayerBorder: 控制图层为空\n");
    return false;
  }
  
  const std::string& layerName = controlLayer->name();
  // printf("[DEBUG] isPointOnControlLayerBorder: 检测控制图层 '%s' 在点 (%.2f, %.2f)\n", layerName.c_str(), x, y);
  
  // 对于角控制器，整个区域都算边框（因为角控制器本身就是用来操作的）
  if (layerName == "__CORNER_HANDLE__") {
    // printf("[DEBUG] isPointOnControlLayerBorder: 角控制器，返回 true\n");
    return true;
  }
  
  // 对于选择边框，使用简化的检测逻辑
  // 参考旋转功能的实现：如果有选中图层，检查是否在选中图层内部
  if (layerName == "__SELECTION_BORDER__") {
    // printf("[DEBUG] isPointOnControlLayerBorder: 选择边框检测\n");
    // 如果有选中的图层，检查点是否在选中图层内部
    if (selectedTargetLayer) {
      // 使用现有的 isPointInSelectedLayer 方法检测
      bool isInSelectedLayer = isPointInSelectedLayer(x, y);
      // printf("[DEBUG] isPointOnControlLayerBorder: 点在选中图层内部: %s\n", isInSelectedLayer ? "是" : "否");
      // 如果在选中图层内部，说明不在边框上（类似旋转功能的逻辑）
      bool result = !isInSelectedLayer;
      // printf("[DEBUG] isPointOnControlLayerBorder: 选择边框结果: %s\n", result ? "在边框上" : "在内部");
      return result;
    }
    // 如果没有选中图层，默认认为在边框上
    // printf("[DEBUG] isPointOnControlLayerBorder: 没有选中图层，默认在边框上\n");
    return true;
  }
  
  // printf("[DEBUG] isPointOnControlLayerBorder: 未知控制图层类型，返回 false\n");
  return false;
}

// ========== 框选功能实现 ==========

void TGFXBaseView::startBoxSelection(float worldX, float worldY) {
  isBoxSelecting = true;
  boxSelectStart = tgfx::Point::Make(worldX, worldY);
  boxSelectEnd = boxSelectStart;
  
  // 创建框选框图层
  selectionBoxLayer = tgfx::ShapeLayer::Make();
  selectionBoxLayer->setBlendMode(tgfx::BlendMode::SrcOver);
  
  // 样式：绿色边框（50%透明） + 绿色填充（30%透明）
  selectionBoxLayer->setStrokeStyle(
    tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 127))  // 50%透明
  );
  selectionBoxLayer->setFillStyle(
    tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 76))   // 30%透明
  );
  
  // 线宽与高亮一致，需要根据缩放调整
  float adjustedLineWidth = lastZoom > 0 ? s_highlightLineWidth / lastZoom : s_highlightLineWidth;
  selectionBoxLayer->setLineWidth(adjustedLineWidth);
  selectionBoxLayer->setStrokeAlign(tgfx::StrokeAlign::Inside);
  selectionBoxLayer->setName("__BOX_SELECTION__");
  
  // 添加到根图层（不需要变换，直接使用世界坐标）
  auto rootLayer = appHost->displayList.root();
  if (rootLayer) {
    rootLayer->addChild(selectionBoxLayer);
  }
  
  appHost->markDirty();
}

void TGFXBaseView::updateBoxSelection(float worldX, float worldY) {
  if (!isBoxSelecting || !selectionBoxLayer) return;
  
  boxSelectEnd = tgfx::Point::Make(worldX, worldY);
  
  // 计算矩形（左上角、右下角）
  float left = std::min(boxSelectStart.x, boxSelectEnd.x);
  float top = std::min(boxSelectStart.y, boxSelectEnd.y);
  float right = std::max(boxSelectStart.x, boxSelectEnd.x);
  float bottom = std::max(boxSelectStart.y, boxSelectEnd.y);
  
  // 更新框选框路径
  tgfx::Path boxPath;
  boxPath.addRect(tgfx::Rect::MakeLTRB(left, top, right, bottom));
  selectionBoxLayer->setPath(boxPath);
  
  // 检测框内图层并实时高亮
  auto rect = tgfx::Rect::MakeLTRB(left, top, right, bottom);
  auto layersInBox = getLayersInRect(rect);
  
  // 清除旧的临时高亮
  for (auto& highlight : tempHighlightLayers) {
    if (highlight && highlight->parent()) {
      highlight->removeFromParent();
    }
  }
  tempHighlightLayers.clear();
  
  // 创建新的临时高亮（复用高亮样式）
  for (auto& layer : layersInBox) {
    auto highlight = createTempHighlight(layer);
    if (highlight) {
      tempHighlightLayers.push_back(highlight);
    }
  }
  
  appHost->markDirty();
}

void TGFXBaseView::endBoxSelection() {
  if (!isBoxSelecting) return;
  
  // 计算最终选择矩形
  float left = std::min(boxSelectStart.x, boxSelectEnd.x);
  float top = std::min(boxSelectStart.y, boxSelectEnd.y);
  float right = std::max(boxSelectStart.x, boxSelectEnd.x);
  float bottom = std::max(boxSelectStart.y, boxSelectEnd.y);
  auto rect = tgfx::Rect::MakeLTRB(left, top, right, bottom);
  
  // 获取框内图层
  selectedLayers = getLayersInRect(rect);
  
  // 清理框选框和临时高亮
  if (selectionBoxLayer) {
    if (selectionBoxLayer->parent()) {
      selectionBoxLayer->removeFromParent();
    }
    selectionBoxLayer.reset();
  }
  
  for (auto& highlight : tempHighlightLayers) {
    if (highlight && highlight->parent()) {
      highlight->removeFromParent();
    }
  }
  tempHighlightLayers.clear();
  
  isBoxSelecting = false;
  
  // 如果选中了0个图层，直接返回
  if (selectedLayers.empty()) {
    appHost->markDirty();
    return;
  }
  
  // 如果只选中1个图层，转为单选模式
  if (selectedLayers.size() == 1) {
    auto layer = selectedLayers[0];
    selectedLayers.clear();
    isMultiSelection = false;
    
    // 直接创建单选效果（不调用selectLayerAndCheckRedraw，因为那个函数需要坐标参数）
    resetSelectedLayer();
    
    // 创建选中边框
    auto selectionBorder = tgfx::ShapeLayer::Make();
    selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
    auto rectPath = tgfx::Path();
    rectPath.addRect(layer->getBounds(nullptr, true));
    if (layer->mask() != nullptr) {
      tgfx::Path maskPath;
      maskPath.addRect(layer->mask()->getBounds());
      selectionBorder->setPath(maskPath);
    } else {
      selectionBorder->setPath(rectPath);
    }
    selectionBorder->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204)));

    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
    float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                             globalMatrix.getSkewY() * globalMatrix.getSkewY());
    float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                             globalMatrix.getScaleY() * globalMatrix.getScaleY());
    float layerAvgScale = (scaleX + scaleY) / 2.0f;
    float totalScale = layerAvgScale * lastZoom;
    float adjustedLineWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
    
    selectionBorder->setLineWidth(adjustedLineWidth);
    selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
    selectionBorder->setMatrix(globalMatrix);
    selectionBorder->setName("__SELECTION_BORDER__");

    auto rootLayer = appHost->displayList.root();
    if (rootLayer) {
      rootLayer->addChild(selectionBorder);
    }

    latestSelectedLayer = selectionBorder;
    selectedTargetLayer = layer;

    // 创建四个角控制器
    createCornerHandles(layer);
    
    appHost->markDirty();
    return;
  }
  
  // 清除单选高亮，进入多选模式
  resetHighlightLayer();
  isMultiSelection = true;
  
  // 创建多选选中框（轴对齐包围盒）
  createMultiSelectionBorder();
  
  appHost->markDirty();
}

void TGFXBaseView::endBoxSelectionWithZoom(float currentZoom) {
  // 更新 lastZoom 确保后续线宽计算正确
  if (currentZoom > 0) {
    lastZoom = currentZoom;
  }
  endBoxSelection();
}

// 获取矩形内的所有图层（递归搜索所有图层，排除父子关系）
std::vector<std::shared_ptr<tgfx::Layer>> TGFXBaseView::getLayersInRect(const tgfx::Rect& rect) {
  std::vector<std::shared_ptr<tgfx::Layer>> result;
  std::unordered_set<tgfx::Layer*> parentSet;  // 用于记录已选中图层的父节点
  
  if (!appHost) return result;
  
  auto root = appHost->displayList.root();
  if (!root) return result;
  
  // 第一遍：收集所有候选图层
  std::vector<std::shared_ptr<tgfx::Layer>> candidates;
  
  std::function<void(std::shared_ptr<tgfx::Layer>)> traverseLayers = 
    [&](std::shared_ptr<tgfx::Layer> layer) {
      if (!layer) return;
      
      // 跳过根图层本身（使用 .get() 比较原始指针）
      if (layer.get() == root) {
        // 只遍历子节点，不添加根图层
        for (auto& child : layer->children()) {
          traverseLayers(child);
        }
        return;
      }
      
      // 跳过控制图层（包括多选边框）
      const std::string& name = layer->name();
      if (name == "__CORNER_HANDLE__" || 
          name == "__SELECTION_BORDER__" ||
          name == "__HIGHLIGHT__" ||
          name == "__BOX_SELECTION__" ||
          name == "__TEMP_HIGHLIGHT__" ||
          name == "__MULTI_SELECTION_BORDER__") {
        return;
      }
      
      // 获取图层在世界坐标的边界
      auto layerBounds = layer->getBounds(root, true);
      
      // 判断是否与框选矩形相交
      if (tgfx::Rect::Intersects(rect, layerBounds)) {
        candidates.push_back(layer);
      }
      
      // 递归遍历子图层
      for (auto& child : layer->children()) {
        traverseLayers(child);
      }
    };
  
  // 从根图层的子节点开始遍历
  for (auto& child : root->children()) {
    traverseLayers(child);
  }
  
  // 第二遍：构建父节点集合
  for (auto& layer : candidates) {
    auto parent = layer->parent();
    while (parent && parent != root) {
      parentSet.insert(parent);
      parent = parent->parent();
    }
  }
  
  // 第三遍：过滤掉子图层（只保留最顶层的父图层）
  for (auto& layer : candidates) {
    // 如果该图层不是任何已选图层的父节点，则保留
    if (parentSet.find(layer.get()) == parentSet.end()) {
      result.push_back(layer);
    }
  }
  
  return result;
}

// 计算轴对齐包围盒（AABB）
tgfx::Rect TGFXBaseView::calculateAxisAlignedBoundingBox() {
  if (selectedLayers.empty()) return tgfx::Rect::MakeEmpty();
  
  auto root = appHost->displayList.root();
  if (!root) return tgfx::Rect::MakeEmpty();
  
  // 初始化极值
  float minX = std::numeric_limits<float>::max();
  float minY = std::numeric_limits<float>::max();
  float maxX = std::numeric_limits<float>::lowest();
  float maxY = std::numeric_limits<float>::lowest();
  
  // 遍历每个选中图层
  for (auto& layer : selectedLayers) {
    // 获取图层的4个顶点（世界坐标）
    auto localBounds = layer->getBounds(nullptr, true);
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
    
    // 4个角的本地坐标
    std::vector<tgfx::Point> corners = {
      tgfx::Point::Make(localBounds.left, localBounds.top),
      tgfx::Point::Make(localBounds.right, localBounds.top),
      tgfx::Point::Make(localBounds.right, localBounds.bottom),
      tgfx::Point::Make(localBounds.left, localBounds.bottom)
    };
    
    // 转换到世界坐标并找极值
    for (auto& corner : corners) {
      tgfx::Point worldPoint;
      globalMatrix.mapXY(corner.x, corner.y, &worldPoint);
      
      minX = std::min(minX, worldPoint.x);
      minY = std::min(minY, worldPoint.y);
      maxX = std::max(maxX, worldPoint.x);
      maxY = std::max(maxY, worldPoint.y);
    }
  }
  
  return tgfx::Rect::MakeLTRB(minX, minY, maxX, maxY);
}

// 计算多选图层的平均缩放（参考单选逻辑）
float TGFXBaseView::calculateMultiSelectionAverageScale() const {
  if (selectedLayers.empty()) return 1.0f;
  
  float totalScale = 0.0f;
  int validLayerCount = 0;
  
  for (const auto& layer : selectedLayers) {
    if (!layer) continue;
    
    // 与单选逻辑一致：获取图层的全局矩阵并提取缩放
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
    float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                             globalMatrix.getSkewY() * globalMatrix.getSkewY());
    float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                             globalMatrix.getScaleY() * globalMatrix.getScaleY());
    float layerAvgScale = (scaleX + scaleY) / 2.0f;
    
    totalScale += layerAvgScale;
    validLayerCount++;
  }
  
  return validLayerCount > 0 ? (totalScale / static_cast<float>(validLayerCount)) : 1.0f;
}

// 创建多选选中框
void TGFXBaseView::createMultiSelectionBorder() {
  if (selectedLayers.empty()) return;
  
  // ⚠️ 不清理旧的选中效果，因为多选模式下不应该有单选状态
  // resetSelectedLayer(); // 删除这行
  
  // 计算轴对齐包围盒（水平矩形）
  auto aabb = calculateAxisAlignedBoundingBox();
  
  // 创建选中边框
  auto selectionBorder = tgfx::ShapeLayer::Make();
  selectionBorder->setBlendMode(tgfx::BlendMode::SrcOver);
  
  tgfx::Path rectPath;
  rectPath.addRect(aabb);
  selectionBorder->setPath(rectPath);
  
  selectionBorder->setStrokeStyle(
    tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204))
  );
  
  // 【修复】多选边框使用世界坐标系绘制（Matrix::I()），不需要考虑图层缩放，只考虑全局缩放
  // 这与单选不同：单选边框跟随图层变换，所以需要考虑图层缩放
  float adjustedLineWidth = lastZoom > 0 ? s_highlightLineWidth / lastZoom : s_highlightLineWidth;
  selectionBorder->setLineWidth(adjustedLineWidth);
  selectionBorder->setStrokeAlign(tgfx::StrokeAlign::Inside);
  selectionBorder->setName("__MULTI_SELECTION_BORDER__");  // 使用独立的名称，避免被高亮检测
  
  // 关键：不设置矩阵，因为AABB已经在世界坐标系中了
  selectionBorder->setMatrix(tgfx::Matrix::I());
  
  auto rootLayer = appHost->displayList.root();
  if (rootLayer) {
    rootLayer->addChild(selectionBorder);
  }
  
  latestSelectedLayer = selectionBorder;
  
  // 为每个选中的图层创建高亮边框（类似临时高亮）
  for (auto& layer : selectedLayers) {
    auto highlight = createTempHighlight(layer);
    if (highlight) {
      tempHighlightLayers.push_back(highlight);
    }
  }
  
  // 【修复】创建角控制器（基于AABB）- 最后添加，确保在最上层
  // 角控制器必须在边框和内部高亮之后添加，这样才能显示在最上面
  createCornerHandlesForAABB(aabb);
}

// 基于AABB创建角控制器
void TGFXBaseView::createCornerHandlesForAABB(const tgfx::Rect& aabb) {
  removeCornerHandles();
  
  auto rootLayer = appHost->displayList.root();
  if (!rootLayer) return;
  
  // 【最终理解】多选角控制器应该只受全局缩放影响，不考虑图层缩放。
  // 这样当用户用角控制器缩放图层时，角控制器本身的大小保持稳定，
  // 避免"双重缩放"的视觉反馈（AABB大小已经在变化了）。
  float borderLineWidth = lastZoom > 0 ? s_highlightLineWidth / lastZoom : s_highlightLineWidth;
  float handleSize = borderLineWidth * s_handleSizeFactor;
  
  // 4个角（世界坐标）
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(aabb.left, aabb.top),
    tgfx::Point::Make(aabb.right, aabb.top),
    tgfx::Point::Make(aabb.right, aabb.bottom),
    tgfx::Point::Make(aabb.left, aabb.bottom)
  };
  
  for (auto& corner : corners) {
    auto handle = tgfx::ShapeLayer::Make();
    
    tgfx::Path path;
    path.addRect(tgfx::Rect::MakeXYWH(
      corner.x - handleSize/2, 
      corner.y - handleSize/2, 
      handleSize, 
      handleSize
    ));
    handle->setPath(path);
    
    handle->setFillStyle(tgfx::SolidColor::Make(tgfx::Color::White()));
    handle->setStrokeStyle(tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41)));
    handle->setLineWidth(borderLineWidth);
    handle->setStrokeAlign(tgfx::StrokeAlign::Outside);
    
    // 关键：角控制器也不需要变换矩阵
    handle->setMatrix(tgfx::Matrix::I());
    handle->setName("__CORNER_HANDLE__");
    
    rootLayer->addChild(handle);
    cornerHandles.push_back(handle);
  }
}

// 更新多选选中框
void TGFXBaseView::updateMultiSelectionBorder() {
  if (selectedLayers.empty() || !latestSelectedLayer) return;
  
  // 重新计算AABB
  auto aabb = calculateAxisAlignedBoundingBox();
  
  // 更新选中边框路径
  auto shapeLayer = std::static_pointer_cast<tgfx::ShapeLayer>(latestSelectedLayer);
  tgfx::Path rectPath;
  rectPath.addRect(aabb);
  shapeLayer->setPath(rectPath);
  
  // 更新内部图层高亮
  for (auto& highlight : tempHighlightLayers) {
    if (highlight && highlight->parent()) {
      highlight->removeFromParent();
    }
  }
  tempHighlightLayers.clear();
  
  for (auto& layer : selectedLayers) {
    auto highlight = createTempHighlight(layer);
    if (highlight) {
      tempHighlightLayers.push_back(highlight);
    }
  }
  
  // 【修复】更新角控制器位置 - 但需要确保角控制器在最上层
  // 先移除旧的角控制器，然后重新创建，这样它们会被添加到最后（显示在最上面）
  auto rootLayer = appHost->displayList.root();
  if (rootLayer && !cornerHandles.empty()) {
    // 先移除所有角控制器
    for (auto& handle : cornerHandles) {
      if (handle && handle->parent()) {
        handle->removeFromParent();
      }
    }
    
    // 重新添加角控制器，确保它们在最上层
    for (auto& handle : cornerHandles) {
      if (handle) {
        rootLayer->addChild(handle);
      }
    }
  }
  
  // 更新角控制器的位置
  updateCornerHandlesForAABB(aabb);
}

// 更新角控制器位置（基于AABB）
void TGFXBaseView::updateCornerHandlesForAABB(const tgfx::Rect& aabb) {
  if (cornerHandles.size() != 4) {
    // 重建角控制器
    createCornerHandlesForAABB(aabb);
    return;
  }
  
  // 【最终理解】多选角控制器应该只受全局缩放影响，不考虑图层缩放。
  // 这样当用户用角控制器缩放图层时，角控制器本身的大小保持稳定。
  float borderLineWidth = lastZoom > 0 ? s_highlightLineWidth / lastZoom : s_highlightLineWidth;
  float handleSize = borderLineWidth * s_handleSizeFactor;
  
  std::vector<tgfx::Point> corners = {
    tgfx::Point::Make(aabb.left, aabb.top),
    tgfx::Point::Make(aabb.right, aabb.top),
    tgfx::Point::Make(aabb.right, aabb.bottom),
    tgfx::Point::Make(aabb.left, aabb.bottom)
  };
  
  for (size_t i = 0; i < 4; ++i) {
    auto shapeHandle = std::static_pointer_cast<tgfx::ShapeLayer>(cornerHandles[i]);
    const auto& corner = corners[i];
    
    tgfx::Path path;
    path.addRect(tgfx::Rect::MakeXYWH(
      corner.x - handleSize/2,
      corner.y - handleSize/2,
      handleSize,
      handleSize
    ));
    shapeHandle->setPath(path);
    shapeHandle->setLineWidth(borderLineWidth);
  }
}

// 清空多选状态
void TGFXBaseView::clearMultiSelection() {
  selectedLayers.clear();
  isMultiSelection = false;
  isMoving = false;  // 重置移动状态，避免状态残留
  
  // 清理多选边框
  if (latestSelectedLayer) {
    latestSelectedLayer->removeFromParent();
    latestSelectedLayer.reset();
  }
  
  // 清理内部图层高亮
  for (auto& highlight : tempHighlightLayers) {
    if (highlight && highlight->parent()) {
      highlight->removeFromParent();
    }
  }
  tempHighlightLayers.clear();
  
  // 清理角控制器
  removeCornerHandles();
}

// 创建临时高亮
std::shared_ptr<tgfx::ShapeLayer> TGFXBaseView::createTempHighlight(std::shared_ptr<tgfx::Layer> layer) {
  if (!layer) return nullptr;
  
  auto highlight = tgfx::ShapeLayer::Make();
  highlight->setBlendMode(tgfx::BlendMode::SrcOver);
  
  // 获取图层边界
  auto bounds = layer->getBounds(nullptr, true);
  
  tgfx::Path rectPath;
  rectPath.addRect(bounds);
  highlight->setPath(rectPath);
  
  // 使用与高亮一致的样式（绿色边框）
  highlight->setStrokeStyle(
    tgfx::SolidColor::Make(tgfx::Color::FromRGBA(130, 182, 41, 204))
  );
  
  // 【修复】计算线宽时考虑图层自身的缩放（与单选逻辑一致）
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
  float scaleX = std::sqrt(globalMatrix.getScaleX() * globalMatrix.getScaleX() + 
                           globalMatrix.getSkewY() * globalMatrix.getSkewY());
  float scaleY = std::sqrt(globalMatrix.getSkewX() * globalMatrix.getSkewX() + 
                           globalMatrix.getScaleY() * globalMatrix.getScaleY());
  float layerScale = (scaleX + scaleY) / 2.0f;
  float totalScale = layerScale * lastZoom;
  float adjustedLineWidth = totalScale > 0 ? s_highlightLineWidth / totalScale : s_highlightLineWidth;
  
  highlight->setLineWidth(adjustedLineWidth);
  highlight->setStrokeAlign(tgfx::StrokeAlign::Inside);
  highlight->setName("__TEMP_HIGHLIGHT__");
  
  // 设置与图层相同的变换矩阵
  highlight->setMatrix(globalMatrix);
  
  auto rootLayer = appHost->displayList.root();
  if (rootLayer) {
    rootLayer->addChild(highlight);
  }
  
  return highlight;
}

// 多选移动（参考单选的移动逻辑）
void TGFXBaseView::moveMultiSelection(float deltaX, float deltaY) {
  printf("\n>>> [moveMultiSelection] 开始执行\n");
  printf("    参数：deltaX=%.2f, deltaY=%.2f\n", deltaX, deltaY);
  printf("    selectedLayers 数量：%zu\n", selectedLayers.size());
  
  if (selectedLayers.empty()) {
    printf("    ❌ selectedLayers 为空，直接返回\n");
    printf("<<< [moveMultiSelection] 结束\n\n");
    return;
  }
  
  // 标记进入移动状态
  printf("    设置 isMoving = true\n");
  isMoving = true;
  
  // 移动时隐藏选中框和角控制器（但不删除）
  if (latestSelectedLayer) {
    printf("    隐藏多选边框\n");
    latestSelectedLayer->setVisible(false);
  }
  for (auto& handle : cornerHandles) {
    if (handle) {
      handle->setVisible(false);
    }
  }
  // 隐藏内部高亮
  for (auto& highlight : tempHighlightLayers) {
    if (highlight) {
      highlight->setVisible(false);
    }
  }
  
  // 遍历每个图层，应用相同的世界坐标增量
  printf("    开始移动 %zu 个图层\n", selectedLayers.size());
  int layerIndex = 0;
  for (auto& layer : selectedLayers) {
    // 将世界坐标增量转换为图层本地坐标
    auto localDelta = CoordinateTransformer::screenDeltaToLayerDelta(
      deltaX, deltaY, lastZoom, layer
    );
    
    printf("      图层%d '%s': 本地增量(%.2f, %.2f)\n", 
           layerIndex++, layer->name().c_str(), localDelta.x, localDelta.y);
    
    auto matrix = layer->matrix();
    matrix.preTranslate(localDelta.x, localDelta.y);
    layer->setMatrix(matrix);
  }
  
  // 更新AABB和视觉效果（但保持隐藏状态）
  printf("    更新多选边框\n");
  updateMultiSelectionBorder();
  
  printf("    标记重绘\n");
  appHost->markDirty();
  
  printf("<<< [moveMultiSelection] 执行完成\n\n");
}

// 多选旋转
void TGFXBaseView::rotateMultiSelection(float deltaAngle) {
  if (selectedLayers.empty()) return;
  
  // 计算旋转中心（AABB的几何中心）
  auto aabb = calculateAxisAlignedBoundingBox();
  tgfx::Point rotationCenter = tgfx::Point::Make(aabb.centerX(), aabb.centerY());
  
  // 遍历每个图层，绕统一中心点旋转
  for (auto& layer : selectedLayers) {
    // 将世界旋转中心转换为图层本地坐标
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
    tgfx::Matrix inverseMatrix = globalMatrix;
    if (!inverseMatrix.invert(&inverseMatrix)) {
      continue;  // 无法求逆，跳过该图层
    }
    
    tgfx::Point localRotationCenter;
    inverseMatrix.mapXY(rotationCenter.x, rotationCenter.y, &localRotationCenter);
    
    // 在本地坐标系中绕中心旋转
    auto matrix = layer->matrix();
    float angleDegrees = deltaAngle * 180.0f / static_cast<float>(M_PI);
    matrix.preRotate(angleDegrees, localRotationCenter.x, localRotationCenter.y);
    layer->setMatrix(matrix);
  }
  
  // 核心：旋转后重新计算AABB（会变大）
  updateMultiSelectionBorder();
  
  appHost->markDirty();
}

// 多选缩放
void TGFXBaseView::scaleMultiSelection(float scaleX, float scaleY, float pivotX, float pivotY) {
  if (selectedLayers.empty()) return;
  
  // pivotX, pivotY 是世界坐标系的缩放中心点（AABB中心或对角点）
  
  for (auto& layer : selectedLayers) {
    // 将世界缩放中心转换为图层本地坐标
    auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(layer);
    tgfx::Matrix inverseMatrix = globalMatrix;
    if (!inverseMatrix.invert(&inverseMatrix)) {
      continue;  // 无法求逆，跳过该图层
    }
    
    // 世界缩放中心 → 图层本地坐标
    tgfx::Point localPivot;
    inverseMatrix.mapXY(pivotX, pivotY, &localPivot);
    
    // 在本地坐标系中应用缩放
    auto matrix = layer->matrix();
    matrix.preScale(scaleX, scaleY, localPivot.x, localPivot.y);
    layer->setMatrix(matrix);
  }
  
  // 缩放后重新计算AABB
  updateMultiSelectionBorder();
  
  appHost->markDirty();
}

// 查询方法
int TGFXBaseView::getSelectedLayersCount() const {
  return static_cast<int>(selectedLayers.size());
}

bool TGFXBaseView::isInMultiSelectionMode() const {
  return isMultiSelection;
}


// ========== 新架构：本地空间交互支持 ==========
/**
 * 获取选中图层的世界变换矩阵
 * 返回: 6 个浮点数 [a, b, c, d, e, f]
 * 矩阵格式：x' = a*x + c*y + e, y' = b*x + d*y + f
 */
std::vector<float> TGFXBaseView::getSelectedLayerWorldMatrix() {
  std::vector<float> result;
  
  if (!selectedTargetLayer) {
    return result;
  }
  
  // 获取图层的全局变换矩阵
  auto globalMatrix = CoordinateTransformer::getLayerToRootMatrix(selectedTargetLayer);
  
  // 提取矩阵的 6 个分量
  // 矩阵格式: a c e
  //           b d f
  //           0 0 1
  result.push_back(globalMatrix.getScaleX());  // a
  result.push_back(globalMatrix.getSkewY());   // b
  result.push_back(globalMatrix.getSkewX());   // c
  result.push_back(globalMatrix.getScaleY());  // d
  result.push_back(globalMatrix.getTranslateX());  // e
  result.push_back(globalMatrix.getTranslateY());  // f
  
  return result;
}

/**
 * 获取选中图层的本地边界
 * 返回: [left, top, right, bottom]
 */
std::vector<float> TGFXBaseView::getSelectedLayerLocalBounds() {
  std::vector<float> result;
  
  if (!selectedTargetLayer) {
    return result;
  }
  
  // 获取图层的本地边界
  auto bounds = selectedTargetLayer->getBounds();
  
  result.push_back(bounds.left);
  result.push_back(bounds.top);
  result.push_back(bounds.right);
  result.push_back(bounds.bottom);
  
  return result;
}

}  // namespace displaylist
