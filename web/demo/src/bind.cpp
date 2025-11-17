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
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "TGFXThreadsView.h"

using namespace displaylist;
using namespace emscripten;

EMSCRIPTEN_BINDINGS(TGFXDemo) {

  // 注册 std::vector<float> 类型
  register_vector<float>("VectorFloat");
  // 注册 std::vector<std::string> 类型
  // register_vector<std::string>("VectorString");

  class_<TGFXBaseView>("TGFXBaseView")
      .function("setImage", &TGFXBaseView::setImage)
      .function("updateSize", &TGFXBaseView::updateSize)
      .function("draw", &TGFXBaseView::draw)
      .function("setAllowBlur", &TGFXBaseView::setAllowBlur)
      .function("getDrawerNames", &TGFXBaseView::getDrawerNames)
      .function("setRenderMode", &TGFXBaseView::setRenderMode)
      .function("setTileSize", &TGFXBaseView::setTileSize)
      .function("setMaxTileCount", &TGFXBaseView::setMaxTileCount)
      .function("setShowDirtyRect", &TGFXBaseView::setShowDirtyRect)
      .function("highlightLayerAndCheckRedraw", &TGFXBaseView::highlightLayerAndCheckRedraw)
      .function("resetHighlightLayer", &TGFXBaseView::resetHighlightLayer)
      .function("selectMoveLayer", &TGFXBaseView::selectMoveLayer)
      .function("moveHighlightLayer", &TGFXBaseView::moveHighlightLayer)
      .function("rotateSelectedLayer", &TGFXBaseView::rotateSelectedLayer)
      .function("endRotation", &TGFXBaseView::endRotation)
      .function("scaleSelectedLayer", &TGFXBaseView::scaleSelectedLayer)
      .function("scaleSelectedLayerWithLocalPivot", &TGFXBaseView::scaleSelectedLayerWithLocalPivot)
      .function("getSelectedLayerCenter", &TGFXBaseView::getSelectedLayerCenter)
      .function("getSelectedLayerInfo", &TGFXBaseView::getSelectedLayerInfo)
      .function("getSelectedLayerRotation", &TGFXBaseView::getSelectedLayerRotation)
      .function("getMoveLayerPosition", &TGFXBaseView::getMoveLayerPosition)
      .function("getMoveLayerGlobalMatrix", &TGFXBaseView::getMoveLayerGlobalMatrix)
      .function("selectLayerAndCheckRedraw", &TGFXBaseView::selectLayerAndCheckRedraw)
      .function("resetSelectedLayer", &TGFXBaseView::resetSelectedLayer)
      .function("setSelectionLineWidth", &TGFXBaseView::setSelectionLineWidth)
      .function("getSelectionLineWidth", &TGFXBaseView::getSelectionLineWidth)
      .function("setHandleSizeFactor", &TGFXBaseView::setHandleSizeFactor)
      .function("getHandleSizeFactor", &TGFXBaseView::getHandleSizeFactor)
      .function("markDirty", &TGFXBaseView::markDirty)
      .function("onWheelEvent", &TGFXBaseView::onWheelEvent)
      .function("resetMoveLayers", &TGFXBaseView::resetMoveLayers)
      .function("onMouseMove", &TGFXBaseView::onMouseMove)
      .function("onMouseDown", &TGFXBaseView::onMouseDown)
      .function("onMouseUp", &TGFXBaseView::onMouseUp)
      .function("getCurrentMouseState", &TGFXBaseView::getCurrentMouseState)
      .function("resetMouseState", &TGFXBaseView::resetMouseState)
      .function("updateCornerHandles", &TGFXBaseView::updateCornerHandles)
      .function("isPointInCornerHandle", &TGFXBaseView::isPointInCornerHandle)
      .function("isPointInRotateZone", &TGFXBaseView::isPointInRotateZone)
      .function("isPointInSelectedLayer", &TGFXBaseView::isPointInSelectedLayer)
      .function("isPointInSelectionBorder", &TGFXBaseView::isPointInSelectionBorder)
      // 框选功能
      .function("startBoxSelection", &TGFXBaseView::startBoxSelection)
      .function("updateBoxSelection", &TGFXBaseView::updateBoxSelection)
      .function("endBoxSelection", &TGFXBaseView::endBoxSelection)
      .function("moveMultiSelection", &TGFXBaseView::moveMultiSelection)
      .function("rotateMultiSelection", &TGFXBaseView::rotateMultiSelection)
      .function("scaleMultiSelection", &TGFXBaseView::scaleMultiSelection)
      .function("getSelectedLayersCount", &TGFXBaseView::getSelectedLayersCount)
      .function("isInMultiSelectionMode", &TGFXBaseView::isInMultiSelectionMode)
      .function("getSelectedLayerCorners", &TGFXBaseView::getSelectedLayerCorners)
      .function("getCornerHandlePosition", &TGFXBaseView::getCornerHandlePosition)
      .function("getSelectedLayerLocalCorner", &TGFXBaseView::getSelectedLayerLocalCorner)
      .function("localToWorldCoords", &TGFXBaseView::localToWorldCoords)
      .function("getActualCornerName", &TGFXBaseView::getActualCornerName)
      .function("getCornerNameByPosition", &TGFXBaseView::getCornerNameByPosition)
      .function("getCornerDetailInfo", &TGFXBaseView::getCornerDetailInfo)
      .function("debugFlipStatus", &TGFXBaseView::debugFlipStatus)
      .function("getOppositeCornerIndex", &TGFXBaseView::getOppositeCornerIndex)
      .function("getOppositeCornerWorldCoords", &TGFXBaseView::getOppositeCornerWorldCoords)
      .function("debugCornerAndOppositeInfo", &TGFXBaseView::debugCornerAndOppositeInfo)
      .function("getSelectedLayerFlipState", &TGFXBaseView::getSelectedLayerFlipState)
      
      ;

  class_<TGFXThreadsView, base<TGFXBaseView>>("TGFXThreadsView")
      .smart_ptr<std::shared_ptr<TGFXThreadsView>>("TGFXThreadsView")
      .class_function("MakeFrom", optional_override([](const std::string& canvasID) {
                        if (canvasID.empty()) {
                          return std::shared_ptr<TGFXThreadsView>(nullptr);
                        }
                        return std::make_shared<TGFXThreadsView>(canvasID);
                      }))
      .function("registerFonts", &TGFXThreadsView::registerFonts);
}