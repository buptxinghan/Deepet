#!/usr/bin/env python3
"""Encode existing GIF frames for the MCU, preserving logical pixels and timing.

The display's RGB565 representation is round-trip checked for every pixel.
Original GIFs are never modified; no intermediate edited images are exported.
"""
from pathlib import Path
import hashlib,json,struct,sys
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets/references/whale-girl'
DEST=ROOT/'firmware/resources/pet'
HEADER=struct.Struct('<4sBBBBHHI')

def decode(data):
    magic,w,h,colors,transparent,count,flags,size=HEADER.unpack_from(data)
    assert magic==b'WSP1' and w==69 and h==66 and size==len(data) and flags==0
    assert 1<=colors<=64 and transparent<colors and 1<=count<=64
    palette=struct.unpack_from('<'+'H'*colors,data,16); offset=16+colors*2; frames=[]
    for _ in range(count):
        duration,reserved,length=struct.unpack_from('<HHI',data,offset);offset+=8;end=offset+length
        assert reserved==0 and duration>0 and end<=len(data)
        pixels=[]
        for _ in range(h):
            rowbytes=struct.unpack_from('<H',data,offset)[0];offset+=2
            assert 0<rowbytes<=w*2 and rowbytes%2==0
            row=[]
            for _ in range(rowbytes//2):
                color,run=struct.unpack_from('BB',data,offset);offset+=2
                assert color<colors and 1<=run<=w
                row.extend([None if color==transparent else palette[color]]*run)
            assert len(row)==w;pixels.extend(row)
        assert offset==end;frames.append((duration,pixels))
    assert offset==len(data)
    return frames

def encode(path):
    palette={None:0};frames=[]
    with Image.open(path) as image:
        assert image.size==(552,528)
        for number in range(image.n_frames):
            image.seek(number);frame=image.convert('RGBA')
            logical=frame.resize((69,66),Image.Resampling.NEAREST)
            restored=logical.resize(frame.size,Image.Resampling.NEAREST)
            # Ignore invisible RGB while requiring equal alpha and visible pixels.
            visible=Image.new('RGBA',frame.size);visible.alpha_composite(frame)
            check=Image.new('RGBA',frame.size);check.alpha_composite(restored)
            assert all(channel.getbbox() is None for channel in ImageChops.difference(visible,check).split()), (path.name,number)
            pixels=[]
            for r,g,b,a in logical.getdata():
                assert a in (0,255)
                color=None if a==0 else ((r>>3)<<11)|((g>>2)<<5)|(b>>3)
                if color not in palette:palette[color]=len(palette)
                pixels.append(color)
            assert len(palette)<=64
            frames.append((max(20,int(image.info.get('duration',100))),pixels))
    body=bytearray()
    for duration,pixels in frames:
        frame=bytearray()
        for y in range(66):
            row=pixels[y*69:(y+1)*69];runs=bytearray();start=0
            for x in range(1,70):
                if x==69 or row[x]!=row[start]:runs.extend((palette[row[start]],x-start));start=x
            frame.extend(struct.pack('<H',len(runs)));frame.extend(runs)
        body.extend(struct.pack('<HHI',duration,0,len(frame)));body.extend(frame)
    colors=list(palette);color_bytes=struct.pack('<'+'H'*len(colors),*[c or 0 for c in colors])
    data=HEADER.pack(b'WSP1',69,66,len(colors),0,len(frames),0,16+len(color_bytes)+len(body))+color_bytes+body
    assert decode(data)==frames
    return data,len(frames)

def main():
    DEST.mkdir(parents=True,exist_ok=True);records=[]
    for source in sorted(SOURCE.glob('*.gif')):
        if source.name.startswith('.'):continue
        original=hashlib.sha256(source.read_bytes()).hexdigest();data,count=encode(source)
        target=DEST/(source.stem+'.spr');target.write_bytes(data)
        assert hashlib.sha256(source.read_bytes()).hexdigest()==original
        records.append(dict(file=target.name,bytes=len(data),frames=count,sha256=hashlib.sha256(data).hexdigest(),source_sha256=original))
    total=sum(r['bytes'] for r in records)
    assert total<=640*1024
    report=dict(format='WSP1',logical_size=[69,66],color_format='RGB565 plus transparent index',animation_bytes=total,files=records,all_frames_round_trip=True,all_originals_unchanged=True)
    (DEST.parent/'sprite-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='files'}))
if __name__=='__main__':main()
