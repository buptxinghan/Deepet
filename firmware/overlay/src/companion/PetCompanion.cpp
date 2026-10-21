// SPDX-License-Identifier: GPL-3.0-or-later
#include "companion/PetCompanion.h"
#include "display/DisplayManager.h"
#include "config/ConfigManager.h"
#include "companion/FirmwareSafety.h"
#include "companion/RecoveryWeb.h"
#include "companion/RenderCanvas.h"
#include "companion/SpriteLayout.h"
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <ESP8266WiFi.h>
#include <time.h>
extern ConfigManager configManager;
extern bool companionOtaBusy();

namespace {
constexpr uint16_t BG = 0x0000, FG = 0xdefb, MUTED = 0x9d98, BUBBLE = 0xefbf, INK = 0x19aa;
Arduino_GFX* lcd = nullptr;
RenderCanvas textCanvas;
struct Entry { const char* id; const char* file; };
const Entry entries[] = {
 {"idle","01-idle"},{"look","02-idle-look"},{"spout","03-idle-spout"},{"thinking","04-thinking"},
 {"typing","05-typing"},{"music","06-music"},{"conducting","07-conducting"},{"building","08-building"},
 {"error","09-error"},{"happy","10-happy"},{"notification","11-notification"},{"compacting","12-compacting"},
 {"carrying","13-carrying"},{"sleeping","14-sleeping"},{"waking","15-waking"},{"poke-left","16-poke-left"},
 {"poke-right","17-poke-right"},{"tickle","18-tickle"},{"drag","19-drag"},{"swim","20-swim"},
 {"smile-hearts","21-smile-hearts"},{"thumbs-up","22-thumbs-up"}
};
String action="idle", message="正在等待 Mac 连接。", sourceMode="mac", note, bridgeId;
String remoteAction; uint32_t remoteUntil=0, noteUntil=0;
bool important=false, dirty=true, received=false, disconnected=false;
bool wasOtaBusy=false;
uint32_t lastReceived=0, lastSeq=0, nextFrame=0, lastClock=0, revision=0;
uint32_t nextSpriteAttempt=0, lastNoteTick=0;
uint32_t minimumHeap=UINT32_MAX;
uint32_t clockDraws=0,bubbleDraws=0,panelDraws=0,frameDraws=0;
bool memoryGuard=false;
uint16_t rotationSeconds=15;
uint8_t serverLimit=2, drawnPanelHeight=40;
int panelHeight();
struct Source { String id,label,temp,metrics[4]; bool available=false; };
Source sources[8]; size_t sourceCount=0;
int panelHeight(){return sourceMode=="servers"?42:40;}
File sprite,font;
uint16_t palette[64], frameCount=0, frameNumber=0, fontCount=0;
uint32_t frameOffsets[64];
uint8_t transparentIndex=0, colorCount=0;
String playing;

bool readBytes(File& file,uint8_t* data,size_t n) { return file.read(data,n)==static_cast<int>(n); }
uint16_t little16(const uint8_t* b){return b[0]|(uint16_t(b[1])<<8);}
uint32_t little32(const uint8_t* b){return uint32_t(b[0])|(uint32_t(b[1])<<8)|(uint32_t(b[2])<<16)|(uint32_t(b[3])<<24);}
bool validAction(const String& value) { for(const auto& e:entries)if(value==e.id)return true;return false; }
bool utf8Bounded(const String& value,size_t limit){size_t count=0;for(size_t i=0;i<value.length();++i)if((uint8_t(value[i])&0xc0)!=0x80)++count;return count<=limit;}

bool loadSprite(const String& id) {
  sprite.close(); playing=""; const char* name=nullptr;
  for(const auto& e:entries)if(id==e.id){name=e.file;break;}
  if(!name)return false;
  sprite=LittleFS.open(String("/pet/")+name+".spr","r");if(!sprite)return false;
  uint8_t h[16];if(!readBytes(sprite,h,16)||memcmp(h,"WSP1",4)||h[4]!=69||h[5]!=66)return false;
  colorCount=h[6];transparentIndex=h[7];frameCount=little16(h+8);
  if(!colorCount||colorCount>64||transparentIndex>=colorCount||!frameCount||frameCount>64||little32(h+12)!=sprite.size())return false;
  uint8_t b[128];if(!readBytes(sprite,b,colorCount*2))return false;
  for(uint8_t i=0;i<colorCount;++i)palette[i]=little16(b+i*2);
  uint32_t offset=16+colorCount*2;
  for(uint16_t i=0;i<frameCount;++i){
    if(!FirmwareSafety::rangeFits(sprite.size(),offset,8)||!sprite.seek(offset,SeekSet)||!readBytes(sprite,b,8))return false;
    frameOffsets[i]=offset;offset+=8;
    const uint32_t length=little32(b+4);
    if(!FirmwareSafety::rangeFits(sprite.size(),offset,length))return false;
    offset+=length;
  }
  if(offset!=sprite.size())return false;
  playing=id;frameNumber=0;nextFrame=0;return true;
}

bool drawFrame(uint32_t now) {
  if(!sprite||playing.isEmpty()||!frameCount)return false;
  uint8_t header[8];if(frameNumber>=frameCount||!sprite.seek(frameOffsets[frameNumber],SeekSet))return false;
  if(!readBytes(sprite,header,8))return false;
  if(!FirmwareSafety::rangeFits(sprite.size(),sprite.position(),little32(header+4)))return false;
  uint32_t end=sprite.position()+little32(header+4);uint16_t duration=little16(header);
  uint8_t runs[138],logical[69];uint16_t row[SpriteLayout::Width];int destinationY=0;
  constexpr int width=SpriteLayout::Width,height=SpriteLayout::Height,left=SpriteLayout::Left;
  const int top=SpriteLayout::top(panelHeight());
  for(int y=0;y<66;++y){
    uint8_t lengthBytes[2];if(!readBytes(sprite,lengthBytes,2))return false;
    uint16_t length=little16(lengthBytes);if(!length||length>138||(length&1)||!FirmwareSafety::rangeFits(end,sprite.position(),length))return false;
    if(!readBytes(sprite,runs,length))return false;
    size_t x=0;
    for(size_t i=0;i<length;i+=2){uint8_t color=runs[i],count=runs[i+1];if(color>=colorCount||!count||x+count>69)return false;while(count--)logical[x++]=color;}
    if(x!=69)return false;
    while(destinationY<height&&destinationY*66/height==y){
      for(int dx=0;dx<width;++dx){const uint8_t color=logical[dx*69/width];row[dx]=color==transparentIndex?SpriteLayout::background(left+dx,top+destinationY,panelHeight(),BG):palette[color];}
      lcd->draw16bitRGBBitmap(left,top+destinationY,row,width,1);++destinationY;
    }
    if((y&7)==0)yield();
  }
  if(sprite.position()!=end)return false;
  ++frameDraws;frameNumber=(frameNumber+1)%frameCount;nextFrame=now+max(uint16_t(40),duration);return true;
}

void openFont(){font.close();fontCount=0;font=LittleFS.open("/font.bin","r");uint8_t h[8];if(!font||!readBytes(font,h,8)||memcmp(h,"WCF1",4)||h[6]!=12||h[7]!=14){font.close();return;}fontCount=little16(h+4);if(fontCount>4368||font.size()!=8+uint32_t(fontCount)*30){font.close();fontCount=0;}}
struct GlyphData { uint8_t rows[28]{};uint8_t advance=12;bool available=false; };
bool readGlyph(uint16_t code,GlyphData& result){
  if(!font||!fontCount)return false;
  int low=0,high=fontCount-1,index=-1;uint8_t b[2];
  while(low<=high){int mid=(low+high)/2;font.seek(8+mid*2,SeekSet);if(!readBytes(font,b,2))return false;uint16_t c=little16(b);if(c==code){index=mid;break;}if(c<code)low=mid+1;else high=mid-1;}
  if(index<0)return false;
  font.seek(8+fontCount*2+index*28,SeekSet);if(!readBytes(font,result.rows,28))return false;
  if(code<128){
    int right=0;
    for(int y=0;y<14;++y){uint16_t bits=little16(result.rows+y*2);for(int x=0;x<12;++x)if(bits&(1<<(15-x)))right=max(right,x+1);}
    result.advance=right?uint8_t(min(12,right+1)):4;
  }
  result.available=true;return true;
}
void paintGlyph(const GlyphData& glyph,int x,int y,uint16_t color){
  for(int row=0;row<14;++row){uint16_t bits=little16(glyph.rows+row*2);for(int col=0;col<12;++col)if(bits&(1<<(15-col)))textCanvas.drawPixel(x+col,y+row,color);}
}
bool glyph(uint16_t code,int x,int y,uint16_t color){GlyphData data;if(!readGlyph(code,data))return false;paintGlyph(data,x,y,color);return true;}
bool latinWord(uint8_t c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'||c=='-'||c=='.';}
int text(const String& value,int x,int y,int width,uint16_t color,int maxLines=2,bool draw=true,int* inkWidth=nullptr){
  int start=x,lines=1;size_t offset=0;
  if(inkWidth)*inkWidth=0;
  auto nextLine=[&](){x=start;y+=16;return ++lines<=maxLines;};
  while(offset<value.length()){
    const size_t characterOffset=offset;uint8_t first=value[offset++];uint32_t code=first;
    if((first&0xe0)==0xc0&&offset<value.length()){code=(first&31)<<6;code|=uint8_t(value[offset++])&63;}
    else if((first&0xf0)==0xe0&&offset+1<value.length()){code=(first&15)<<12;code|=(uint8_t(value[offset++])&63)<<6;code|=uint8_t(value[offset++])&63;}
    else if(first>=0xf0){while(offset<value.length()&&(uint8_t(value[offset])&0xc0)==0x80)++offset;code='?';}
    GlyphData current;readGlyph(uint16_t(code),current);
    // Keep a short Latin word together when it fits a complete line.
    if(first<128&&latinWord(first)&&(characterOffset==0||!latinWord(uint8_t(value[characterOffset-1])))){
      int wordWidth=current.advance;
      for(size_t i=offset;i<value.length()&&latinWord(uint8_t(value[i]))&&wordWidth<=width;++i){GlyphData next;readGlyph(uint8_t(value[i]),next);wordWidth+=next.advance;}
      if(wordWidth<=width&&x>start&&x+wordWidth>start+width&&!nextLine())return maxLines;
    }
    if(x+current.advance>start+width&&!nextLine())return maxLines;
    if(inkWidth){
      int right=current.available?0:10;
      if(current.available)for(int row=0;row<14;++row){const uint16_t bits=little16(current.rows+row*2);for(int col=0;col<12;++col)if(bits&(1<<(15-col)))right=max(right,col+1);}
      if(right)*inkWidth=max(*inkWidth,x-start+right);
    }
    if(draw){if(current.available)paintGlyph(current,x,y,color);else textCanvas.drawRect(x+2,y+2,8,10,color);}
    x+=current.advance;
    if((offset&3)==0)yield();
  }
  return lines;
}
// Rendering cache is keyed by visible text, style and position, not packets.
struct RenderedField {
  String value;int16_t x=0,y=0,width=0,height=0;uint16_t color=0;uint8_t style=0;bool valid=false;
};
RenderedField rendered[11];
String renderedBubble,renderedMode;
bool bubbleValid=false,renderedImportant=false;
int renderedLayout=-1;
void invalidateRendering(){
  for(auto& field:rendered)field.valid=false;
  bubbleValid=false;renderedLayout=-1;
}
void small(const String& value,int x,int y,uint16_t color=1,uint8_t size=1){textCanvas.setTextWrap(false);textCanvas.setTextSize(size);textCanvas.setTextColor(color,0);textCanvas.setCursor(x,y);textCanvas.print(value);}
bool field(size_t index,const String& value,int x,int y,int width,int height,uint16_t color=FG,uint8_t size=1,bool chinese=false,bool rightAlign=false){
  auto& previous=rendered[index];const uint8_t style=(chinese?0x80:size)|(rightAlign?0x40:0);
  if(previous.valid&&previous.value==value&&previous.color==color&&previous.x==x&&previous.y==y&&previous.width==width&&previous.height==height&&previous.style==style)return false;
  textCanvas.clear();
  if(chinese){
    int inkWidth=0;
    // Measure only on a cache miss; keep the fixed patch to erase old glyphs.
    if(rightAlign)text(value,0,0,width,1,1,false,&inkWidth);
    text(value,rightAlign?max(0,width-inkWidth):0,0,width,1,1);
  }else small(value,0,0,1,size);
  textCanvas.present(*lcd,x,y,width,height,color,BG,BG);
  previous.value=value;previous.color=color;previous.x=x;previous.y=y;previous.width=width;previous.height=height;previous.style=style;previous.valid=true;
  return true;
}
int selectedSource(uint32_t now){if(!sourceCount)return -1;if(sourceMode=="rotate")return (now/(uint32_t(rotationSeconds)*1000))%sourceCount;for(size_t i=0;i<sourceCount;++i)if(sources[i].id==sourceMode)return int(i);return 0;}
void header(uint32_t now){
  time_t epoch=time(nullptr)+8*3600;struct tm info;gmtime_r(&epoch,&info);char clock[8],date[18];
  if(epoch>1700000000){snprintf(clock,sizeof(clock),"%02d:%02d",info.tm_hour,info.tm_min);snprintf(date,sizeof(date),"%02d/%02d",info.tm_mon+1,info.tm_mday);}else{strcpy(clock,"--:--");strcpy(date,"NTP...");}
  bool changed=field(0,clock,12,9,66,16,FG,2);
  const char* weekdays[]={"周日","周一","周二","周三","周四","周五","周六"};
  const String calendar=String(date)+(epoch>1700000000?String(" ")+weekdays[info.tm_wday]:String(""));
  changed=field(1,calendar,148,9,80,16,MUTED,1,true,true)||changed;
  if(changed)++clockDraws;
  const int height=panelHeight(),top=240-height;
  bool panelChanged=false;
  if(renderedLayout!=height||renderedMode!=sourceMode){
    lcd->fillRect(0,198,240,42,BG);
    for(size_t i=2;i<11;++i)rendered[i].valid=false;
    renderedLayout=height;renderedMode=sourceMode;panelChanged=true;
    if(sourceMode=="servers")lcd->drawFastVLine(120,top+4,height-8,0x21ec);
  }
  if(sourceMode=="servers"){
    size_t count=0;
    for(size_t i=0;i<sourceCount&&count<2;++i){
      const Source& source=sources[i];if(source.id=="mac")continue;
      const bool valid=!disconnected&&source.available;const int x=count*120;const size_t base=2+count*4;
      panelChanged=field(base,source.id.substring(0,16),x+10,top+4,100,8,valid?MUTED:0x7bf0)||panelChanged;
      String gpu="--",memory="--",ram="--";
      if(valid){
        gpu=source.metrics[0];if(gpu.startsWith("GPU "))gpu=gpu.substring(4);
        memory=source.metrics[1];if(memory.startsWith("VRAM "))memory=memory.substring(5);
        int slash=memory.indexOf('/');if(slash>0)memory=memory.substring(0,slash)+"G";
        ram=source.metrics[3];if(ram.startsWith("RAM "))ram=ram.substring(4);
      }
      // Each value is a complete tiny patch, including its stable label.
      const String values[]={gpu.substring(0,4),ram.substring(0,4),memory.substring(0,6)};
      const char* labels[]={"GPU","RAM","VRAM"};const int positions[]={10,44,80},widths[]={32,32,39};
      for(size_t j=0;j<3;++j){
        auto& previous=rendered[base+1+j];
        if(!previous.valid||previous.value!=values[j]||previous.color!=(valid?FG:uint16_t(0x7bf0))){
          textCanvas.clear();small(labels[j],0,0);small(values[j],0,11);
          textCanvas.present(*lcd,x+positions[j],top+15,widths[j],19,valid?FG:0x7bf0,BG,BG);
          previous.value=values[j];previous.color=valid?FG:0x7bf0;previous.valid=true;panelChanged=true;
        }
      }
      ++count;
    }
    while(count<2){
      const int x=count*120;const size_t base=2+count*4;
      panelChanged=field(base,"UNSELECTED",x+10,top+4,100,8,MUTED)||panelChanged;
      panelChanged=field(base+1,"--",x+10,top+15,109,19,MUTED)||panelChanged;
      // A future source must replace every value, even if its text matches.
      rendered[base+2].valid=false;rendered[base+3].valid=false;++count;
    }
  }else{
    int index=selectedSource(now);
    if(index<0){
      panelChanged=field(2,WiFi.localIP().toString(),10,202,174,14,MUTED)||panelChanged;
      panelChanged=field(3,"",195,204,45,10,MUTED)||panelChanged;
      panelChanged=field(4,"Waiting for Mac",10,222,230,16,MUTED)||panelChanged;
      for(size_t i=5;i<8;++i)rendered[i].valid=false;
    }else{
      const Source& source=sources[index];bool valid=!disconnected&&source.available;
      String title=source.label;if(title.length()>20)title=source.id;
      panelChanged=field(2,title,10,202,174,14,MUTED,1,true)||panelChanged;
      panelChanged=field(3,valid?source.temp:String("-- C"),195,204,45,10,MUTED)||panelChanged;
      const int positions[]={10,68,126,184};
      for(size_t i=0;i<4;++i){String value=valid?source.metrics[i]:String("--");if(value.startsWith("VRAM ")){int slash=value.indexOf('/');if(slash>0)value="MEM "+value.substring(5,slash)+"G";}
        panelChanged=field(4+i,value.substring(0,9),positions[i],222,i==3?56:58,16,FG)||panelChanged;
      }
    }
  }
  if(panelChanged)++panelDraws;
}
int previousBubbleHeight=0;
void bubble(const String& value){
  if(bubbleValid&&renderedBubble==value&&renderedImportant==important)return;
  constexpr int width=SpriteLayout::BubbleWidth;
  const int lines=text(value,0,0,width-16,1,SpriteLayout::BubbleMaxLines,false);
  const int height=lines*16+12;
  textCanvas.clear(width,height);text(value,8,6,width-16,1,SpriteLayout::BubbleMaxLines);
  textCanvas.present(*lcd,SpriteLayout::BubbleX,SpriteLayout::BubbleY,width,height,INK,important?0xff39:BUBBLE,BG,7);
  if(previousBubbleHeight>height)lcd->fillRect(SpriteLayout::BubbleX,SpriteLayout::BubbleY+height,width,previousBubbleHeight-height,BG);
  // A left-pointing tail sits outside the sprite canvas, so frames cannot erase it.
  for(int y=0;y<10;++y){const int width=5-abs(y-4);if(width>0)lcd->drawFastHLine(SpriteLayout::BubbleX-width,SpriteLayout::BubbleY+17+y,width,important?0xff39:BUBBLE);}
  previousBubbleHeight=height;renderedBubble=value;renderedImportant=important;bubbleValid=true;++bubbleDraws;
}
String offlineAction(){time_t value=time(nullptr)+8*3600;struct tm t;gmtime_r(&value,&t);return value>1700000000&&(t.tm_hour>=21||t.tm_hour<7)?"sleeping":"idle";}
bool authorized(ESP8266WebServer& server){String value=server.header("Authorization"),expected=String("Bearer ")+configManager.getApiToken();if(configManager.getApiToken()[0]&&value==expected)return true;server.send(401,"application/json","{\"error\":\"unauthorized\"}");return false;}
void reply(ESP8266WebServer& server,JsonDocument& doc){String output;serializeJson(doc,output);server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",output);}
void loadSettings(){
  File file=LittleFS.open("/companion.json","r");if(!file||file.size()>1024)return;
  JsonDocument doc;if(deserializeJson(doc,file,DeserializationOption::NestingLimit(4)))return;
  String mode=doc["source"]|"mac";if(mode.length()&&mode.length()<=80)sourceMode=mode;
  int seconds=doc["rotation_seconds"]|15;
  rotationSeconds=FirmwareSafety::validRotationSeconds(seconds)?seconds:15;serverLimit=2;
}
void saveSettings(){JsonDocument doc;doc["source"]=sourceMode;doc["rotation_seconds"]=rotationSeconds;doc["server_limit"]=serverLimit;File file=LittleFS.open("/companion.new","w");if(file){serializeJson(doc,file);file.close();LittleFS.rename("/companion.new","/companion.json");}}
}

namespace PetCompanion {
void suspendForUpdate(){sprite.close();font.close();fontCount=0;playing="";wasOtaBusy=true;}
void begin(Webserver* web){
  lcd=DisplayManager::getGfx();openFont();loadSettings();lcd->fillScreen(BG);invalidateRendering();
  auto& server=web->raw();
  server.on("/api/v1/companion/status",HTTP_GET,[&server](){
    if(!authorized(server))return;JsonDocument doc;doc["protocol"]=1;doc["version"]="0.1.5";doc["pet_width"]=SpriteLayout::Width;doc["pet_height"]=SpriteLayout::Height;doc["bubble_layout"]="right";doc["ground_shadow"]=true;doc["render_bubble_draws"]=bubbleDraws;doc["render_clock_draws"]=clockDraws;doc["render_panel_draws"]=panelDraws;doc["render_frame_draws"]=frameDraws;doc["render_buffer_bytes"]=RenderCanvas::BufferBytes;doc["mac"]=WiFi.macAddress();doc["source"]=sourceMode;doc["server_list"]=true;doc["server_columns"]=true;doc["server_limit"]=serverLimit;doc["rotation_seconds"]=rotationSeconds;doc["revision"]=revision;doc["last_update_age_ms"]=received?millis()-lastReceived:0;doc["connected"]=received&&!disconnected;doc["free_heap"]=ESP.getFreeHeap();doc["minimum_heap_block"]=ESP.getMaxFreeBlockSize();doc["minimum_free_heap"]=minimumHeap;doc["memory_guard"]=memoryGuard;doc["uptime_ms"]=millis();doc["flash_real_bytes"]=ESP.getFlashChipRealSize();doc["flash_config_bytes"]=ESP.getFlashChipSize();doc["free_sketch_bytes"]=ESP.getFreeSketchSpace();doc["reset_reason"]=ESP.getResetReason();doc["recovery_page"]="/recovery";doc["asset_upload"]=true;doc["action"]=action;doc["playing"]=playing;doc["sprite_ready"]=!playing.isEmpty();doc["font_ready"]=bool(font);doc["note"]=note;JsonArray list=doc["sources"].to<JsonArray>();for(size_t i=0;i<sourceCount;++i){JsonObject item=list.add<JsonObject>();item["id"]=sources[i].id;item["label"]=sources[i].label;}FSInfo info{};if(LittleFS.info(info)){doc["fs_free"]=info.totalBytes-info.usedBytes;doc["fs_total"]=info.totalBytes;}reply(server,doc);
  });
  server.on("/api/v1/companion/state",HTTP_POST,[&server](){
    if(!authorized(server))return;String body=server.arg("plain");if(body.length()>6144){server.send(413,"application/json","{}");return;}
    if(ESP.getFreeHeap()<12000||ESP.getMaxFreeBlockSize()<8192){server.send(503,"application/json","{\"error\":\"low_memory\"}");return;}
    JsonDocument doc;if(deserializeJson(doc,body)||doc["protocol"]!=1||!doc["sources"].is<JsonArray>()){server.send(400,"application/json","{}");return;}
    String incoming=doc["action"]|"idle",incomingText=doc["text"]|"",incomingBridge=doc["bridge"]|"";uint32_t sequence=doc["seq"]|0;
    if(!validAction(incoming)||!utf8Bounded(incomingText,64)||incomingBridge.length()>32){server.send(400,"application/json","{}");return;}
    if(incomingBridge==bridgeId&&sequence<=lastSeq){server.send(200,"application/json","{\"duplicate\":true}");return;}
    bridgeId=incomingBridge;lastSeq=sequence;action=incoming;message=incomingText;important=doc["important"]|false;
    if(important){remoteAction="";remoteUntil=0;}
    sourceCount=0;for(JsonObject item:doc["sources"].as<JsonArray>()){
      if(sourceCount>=8)break;Source& source=sources[sourceCount++];source.id=String(item["id"]|"").substring(0,80);source.label=String(item["label"]|"").substring(0,32);source.temp=String(item["temperature"]|"--").substring(0,10);source.temp.replace("°C","C");source.available=item["available"]|false;
      for(size_t i=0;i<4;++i)source.metrics[i]=String(item["metrics"][i]|"--").substring(0,14);
    }
    received=true;disconnected=false;lastReceived=millis();dirty=true;server.send(200,"application/json","{\"ok\":true}");
  });
  server.on("/api/v1/companion/settings",HTTP_POST,[&server](){
    if(!authorized(server))return;JsonDocument doc;String body=server.arg("plain");if(body.length()>1024||deserializeJson(doc,body)){server.send(400,"application/json","{}");return;}
    String nextSource=sourceMode;int nextRotation=rotationSeconds,nextLimit=serverLimit;
    if(!doc["source"].isNull()){
      if(!doc["source"].is<const char*>()){server.send(400,"application/json","{}");return;}
      nextSource=doc["source"].as<String>();bool valid=nextSource=="mac"||nextSource=="rotate"||nextSource=="servers";
      for(size_t i=0;i<sourceCount;++i)valid=valid||sources[i].id==nextSource;
      if(!valid){server.send(400,"application/json","{}");return;}
    }
    if(!doc["rotation_seconds"].isNull()){
      if(!doc["rotation_seconds"].is<int>()){server.send(400,"application/json","{}");return;}
      nextRotation=doc["rotation_seconds"].as<int>();if(nextRotation!=10&&nextRotation!=15&&nextRotation!=30&&nextRotation!=60){server.send(400,"application/json","{}");return;}
    }
    if(!doc["server_limit"].isNull()){
      if(!doc["server_limit"].is<int>()){server.send(400,"application/json","{}");return;}
      nextLimit=doc["server_limit"].as<int>();if(nextLimit!=2){server.send(400,"application/json","{}");return;}
    }
    if(sourceMode!=nextSource||rotationSeconds!=nextRotation||serverLimit!=nextLimit){sourceMode=nextSource;rotationSeconds=nextRotation;serverLimit=nextLimit;++revision;saveSettings();}
    dirty=true;server.send(200,"application/json","{\"ok\":true}");
  });
  server.on("/api/v1/companion/action",HTTP_POST,[&server](){
    if(!authorized(server))return;if(important&&!disconnected){server.send(409,"application/json","{\"error\":\"important_reminder\"}");return;}
    JsonDocument doc;String body=server.arg("plain");if(body.length()>1024||deserializeJson(doc,body)){server.send(400,"application/json","{}");return;}
    String kind=doc["kind"]|"";
    if(kind=="greet")remoteAction="poke-left";else if(kind=="tickle")remoteAction="tickle";else if(kind=="praise")remoteAction="thumbs-up";else{server.send(400,"application/json","{}");return;}
    remoteUntil=millis()+2400;dirty=true;server.send(200,"application/json","{\"ok\":true}");
  });
  server.on("/api/v1/companion/note",HTTP_POST,[&server](){
    if(!authorized(server))return;JsonDocument doc;String body=server.arg("plain");if(body.length()>1024||deserializeJson(doc,body)){server.send(400,"application/json","{}");return;}
    String value=doc["text"]|"";if(!utf8Bounded(value,28)){server.send(400,"application/json","{}");return;}note=value;noteUntil=(doc["pinned"]|true)?0:millis()+8000;dirty=true;server.send(200,"application/json","{\"ok\":true}");
  });
  DeepetRecovery::begin(server);
}
void update(){
  if(!lcd)return;
  bool ota=companionOtaBusy()||DeepetRecovery::busy();if(ota){wasOtaBusy=true;return;}
  const uint32_t freeHeap=ESP.getFreeHeap();if(freeHeap<minimumHeap)minimumHeap=freeHeap;
  if(freeHeap<8192||ESP.getMaxFreeBlockSize()<4096){memoryGuard=true;suspendForUpdate();return;}
  memoryGuard=false;
  if(wasOtaBusy){wasOtaBusy=false;openFont();lcd->fillScreen(BG);invalidateRendering();dirty=true;playing="";}
  uint32_t now=millis();
  if(drawnPanelHeight!=panelHeight()){
    const int oldTop=SpriteLayout::top(drawnPanelHeight),newTop=SpriteLayout::top(panelHeight());
    // Clear only the old/new sprite footprint; the right bubble stays cached.
    lcd->fillRect(SpriteLayout::Left,min(oldTop,newTop),SpriteLayout::Width,SpriteLayout::Height+abs(oldTop-newTop),BG);
    drawnPanelHeight=panelHeight();nextFrame=0;dirty=true;
  }
  if(noteUntil&&important&&received&&!disconnected&&lastNoteTick)noteUntil+=now-lastNoteTick;
  lastNoteTick=now;
  bool stale=received&&now-lastReceived>15000;
  if(stale!=disconnected){disconnected=stale;dirty=true;}
  if(remoteUntil&&int32_t(now-remoteUntil)>=0){remoteUntil=0;remoteAction="";dirty=true;}
  if(noteUntil&&int32_t(now-noteUntil)>=0){noteUntil=0;note="";dirty=true;}
  String wanted=(!received||disconnected)?offlineAction():action;
  if(remoteUntil&&!important)wanted=remoteAction;
  if(playing!=wanted&&FirmwareSafety::due(now,nextSpriteAttempt)){if(!loadSprite(wanted)&&wanted!="idle")loadSprite("idle");nextSpriteAttempt=playing==wanted?0:now+3000;if(playing.isEmpty())sprite.close();dirty=true;}
  if(dirty){String value=(!received||disconnected)?String(disconnected?"Mac 已离线，本地陪伴继续。":"等待 Mac 连接，先陪着你。"):message;if(note.length()&&(!important||disconnected))value=note;if(remoteUntil&&!important)value="嘿嘿，我在这里陪着你。";bubble(value);header(now);dirty=false;}
  if(now-lastClock>=1000){lastClock=now;header(now);}
  if(!playing.isEmpty()&&FirmwareSafety::due(now,nextFrame)){if(!drawFrame(now)){sprite.close();playing="";nextFrame=now+1000;nextSpriteAttempt=now+3000;}}
}
}
