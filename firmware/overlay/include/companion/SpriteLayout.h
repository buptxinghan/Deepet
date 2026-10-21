#pragma once
#include <stdint.h>

namespace SpriteLayout {
constexpr int Width=160, Height=153, Left=4;
constexpr int BubbleX=170, BubbleY=50, BubbleWidth=64, BubbleMaxLines=8;
constexpr int ShadowRadiusX=56,ShadowRadiusY=4;
constexpr int top(int panel){return 240-panel-Height;}
constexpr int shadowX(){return Left+Width/2;}
constexpr int shadowY(int panel){return top(panel)+Height*62/66;}
inline uint16_t background(int x,int y,int panel,uint16_t base){
  const int dx=x-shadowX(),dy=y-shadowY(panel);
  if(dx<-ShadowRadiusX||dx>ShadowRadiusX||dy<-ShadowRadiusY||dy>ShadowRadiusY)return base;
  const int32_t distance=int32_t(dx)*dx*ShadowRadiusY*ShadowRadiusY+int32_t(dy)*dy*ShadowRadiusX*ShadowRadiusX;
  const int32_t edge=ShadowRadiusX*ShadowRadiusX*ShadowRadiusY*ShadowRadiusY;
  if(distance>edge)return base;
  return distance<edge/4?0x3186:distance<edge*3/4?0x2104:0x1082;
}
static_assert(Left+Width<=BubbleX-6,"Keep the sprite outside the bubble and tail");
static_assert(top(42)>=32,"Keep every animation below the clock");
static_assert(BubbleY+BubbleMaxLines*16+12<=198,"Keep long notes above server metrics");
}
