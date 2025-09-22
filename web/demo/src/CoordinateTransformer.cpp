#include "CoordinateTransformer.h"

tgfx::Matrix CoordinateTransformer::getLayerToRootMatrix(std::shared_ptr<tgfx::Layer> layer) {
    if (!layer) {
        return tgfx::Matrix::I();
    }
    
    return calculateTransformMatrix(layer);
}

tgfx::Point CoordinateTransformer::screenDeltaToLayerDelta(
    float screenDeltaX, 
    float screenDeltaY, 
    float zoom, 
    std::shared_ptr<tgfx::Layer> layer
) {
    if (!layer) {
        return tgfx::Point::Make(0, 0);
    }
    
    // 屏幕坐标 → 视图坐标
    float viewDeltaX = screenDeltaX / zoom;
    float viewDeltaY = screenDeltaY / zoom;
    
    // 视图坐标 → 图层本地坐标
    auto viewPoint1 = tgfx::Point::Make(0, 0);
    auto viewPoint2 = tgfx::Point::Make(viewDeltaX, viewDeltaY);
    
    auto localPoint1 = layer->globalToLocal(viewPoint1);
    auto localPoint2 = layer->globalToLocal(viewPoint2);
    
    return tgfx::Point::Make(
        localPoint2.x - localPoint1.x,
        localPoint2.y - localPoint1.y
    );
}

tgfx::Point CoordinateTransformer::screenToLayerLocal(
    float screenX, 
    float screenY,
    float zoom,
    std::shared_ptr<tgfx::Layer> layer
) {
    if (!layer) {
        return tgfx::Point::Make(0, 0);
    }
    
    // 屏幕坐标 → 视图坐标
    float viewX = screenX / zoom;
    float viewY = screenY / zoom;
    
    // 视图坐标 → 图层本地坐标
    auto viewPoint = tgfx::Point::Make(viewX, viewY);
    return layer->globalToLocal(viewPoint);
}

tgfx::Matrix CoordinateTransformer::calculateTransformMatrix(std::shared_ptr<tgfx::Layer> layer) {
    // 采样关键点：原点、X轴单位向量、Y轴单位向量
    auto origin = layer->localToGlobal(tgfx::Point::Make(0, 0));
    auto unitX = layer->localToGlobal(tgfx::Point::Make(1, 0));  
    auto unitY = layer->localToGlobal(tgfx::Point::Make(0, 1));
    
    // 构建全局变换矩阵
    auto globalMatrix = tgfx::Matrix();
    globalMatrix.setScaleX(unitX.x - origin.x);
    globalMatrix.setSkewX(unitY.x - origin.x);
    globalMatrix.setSkewY(unitX.y - origin.y);
    globalMatrix.setScaleY(unitY.y - origin.y);
    globalMatrix.setTranslateX(origin.x);
    globalMatrix.setTranslateY(origin.y);
    
    return globalMatrix;
}