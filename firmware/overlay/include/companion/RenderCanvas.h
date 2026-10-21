#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// One reusable 1-bit text patch and one RGB565 output row: 1,920 bytes.
// The physical LCD never sees glyph-by-glyph drawing or a blank text field.
class RenderCanvas : public Arduino_GFX {
 public:
  static constexpr int Width=240, Height=48, MaxHeight=144;
  static constexpr size_t BufferBytes=Width*Height/8+Width*sizeof(uint16_t);
  RenderCanvas():Arduino_GFX(Width,MaxHeight){}
  bool begin(int32_t = -1) override { return true; }
  void writePixelPreclipped(int16_t x,int16_t y,uint16_t color) override {
    if(x<0||x>=activeWidth||y<0||y>=activeHeight)return;
    const size_t index=size_t(y)*activeWidth+x;
    const uint8_t mask=uint8_t(1U<<(index&7));
    if(color)bits[index>>3]|=mask;else bits[index>>3]&=uint8_t(~mask);
  }
  bool clear(int width=Width,int height=Height){
    if(width<=0||width>Width||height<=0||height>MaxHeight||size_t(width)*height>Width*Height)return false;
    activeWidth=width;activeHeight=height;memset(bits,0,sizeof(bits));return true;
  }
  void present(Arduino_GFX& output,int x,int y,int width,int height,
               uint16_t foreground,uint16_t background,uint16_t outside,int radius=0){
    if(width<=0||width>activeWidth||height<=0||height>activeHeight||radius<0||radius>width/2||radius>height/2)return;
    for(int dy=0;dy<height;++dy){
      for(int dx=0;dx<width;++dx){
        bool inside=true;
        if(radius){
          const int cx=dx<radius?radius-1-dx:dx>=width-radius?dx-(width-radius):0;
          const int cy=dy<radius?radius-1-dy:dy>=height-radius?dy-(height-radius):0;
          inside=cx*cx+cy*cy<=radius*radius;
        }
        const size_t index=size_t(dy)*activeWidth+dx;
        row[dx]=!inside?outside:(bits[index>>3]&(1U<<(index&7)))?foreground:background;
      }
      output.draw16bitRGBBitmap(x,y+dy,row,width,1);
      if((dy&7)==0)yield();
    }
  }
 private:
  int16_t activeWidth=Width,activeHeight=Height;
  uint8_t bits[Width*Height/8]{};
  uint16_t row[Width]{};
};
static_assert(RenderCanvas::BufferBytes==1920,"Keep render scratch memory bounded");
