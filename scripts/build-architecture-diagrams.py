"""Render the audited and current flight-booking architecture as standalone PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs'
FONT = Path('C:/Windows/Fonts/segoeui.ttf')
BOLD = Path('C:/Windows/Fonts/segoeuib.ttf')
NAVY = '#14243a'
MUTED = '#53657a'
BLUE = '#2563eb'
GREEN = '#07835b'
AMBER = '#a56208'
RED = '#bc4146'
BG = '#f5f8fc'

def font(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), size)

def text(d, xy, value, size=23, color=NAVY, bold=False, anchor=None):
    d.text(xy, value, font=font(size,bold), fill=color, anchor=anchor)

def card(d, box, title, detail, color=BLUE, dashed=False):
    x1,y1,x2,y2=box
    if dashed:
        d.rounded_rectangle(box,24,fill='white')
        for x in range(x1+15,x2-15,27):
            d.line((x,y1,x+15,y1),fill=color,width=4)
            d.line((x,y2,x+15,y2),fill=color,width=4)
        for y in range(y1+15,y2-15,27):
            d.line((x1,y,x1,y+15),fill=color,width=4)
            d.line((x2,y,x2,y+15),fill=color,width=4)
    else:
        d.rounded_rectangle(box,24,fill='white',outline='#dce4ef',width=2)
        d.rounded_rectangle((x1,y1,x1+9,y2),5,fill=color)
    text(d,(x1+27,y1+22),title,27,color,bold=True)
    for n,line in enumerate(detail):
        text(d,(x1+27,y1+64+n*29),line,20,MUTED)

def arrow(d, points, color=BLUE, width=5, label=None, label_xy=None):
    d.line(points,fill=color,width=width,joint='curve')
    x1,y1=points[-2];x2,y2=points[-1]
    if x2!=x1:
        s=1 if x2>x1 else -1
        tip=[(x2,y2),(x2-s*17,y2-10),(x2-s*17,y2+10)]
    else:
        s=1 if y2>y1 else -1
        tip=[(x2,y2),(x2-10,y2-s*17),(x2+10,y2-s*17)]
    d.polygon(tip,fill=color)
    if label and label_xy:
        text(d,label_xy,label,18,MUTED)

def canvas(title, subtitle):
    im=Image.new('RGB',(1800,1100),BG)
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((35,30,1765,1055),32,fill='white')
    d.rounded_rectangle((35,30,1765,137),32,fill=NAVY)
    d.rectangle((35,105,1765,137),fill=NAVY)
    text(d,(75,58),title,39,'white',bold=True)
    text(d,(75,155),subtitle,23,MUTED)
    return im,d

im,d=canvas('BEFORE  |  Original audited system','Single Node process per service  •  one local MySQL server  •  no Redis or RabbitMQ')
card(d,(70,300,260,415),'Client',['HTTP requests'],NAVY)
card(d,(350,210,610,350),'Gateway',['5/IP/2 min limit','flight routes only'],RED)
card(d,(705,220,975,345),'Auth',['JWT validation','MySQL schema'],BLUE)
card(d,(1050,220,1320,365),'Flights',['Search + availability','read / overwrite seats'],RED)
card(d,(1415,235,1715,365),'Flight MySQL',['Full search scan','~10k rows/query'],AMBER)
card(d,(350,480,610,625),'Booking',['Direct API','sync flight calls'],RED)
card(d,(705,505,975,640),'Booking MySQL',['Booking records','no durable recovery'],AMBER)
card(d,(1050,690,1320,830),'Notifications',['Separate ticket API','minute cron'],BLUE)
card(d,(1415,700,1715,825),'Notification MySQL',['Scheduled tickets'],AMBER)
arrow(d,[(260,335),(310,335),(310,280),(350,280)])
arrow(d,[(610,260),(705,260)],label='validate token',label_xy=(620,230))
arrow(d,[(610,320),(650,320),(650,390),(1010,390),(1010,320),(1050,320)],label='proxy flights',label_xy=(760,358))
arrow(d,[(1320,292),(1415,292)],label='SQL',label_xy=(1352,265))
arrow(d,[(260,380),(300,380),(300,550),(350,550)],label='direct booking',label_xy=(80,468))
arrow(d,[(610,560),(705,560)])
arrow(d,[(480,480),(480,435),(1160,435),(1160,365)],label='flight call + seat update',label_xy=(685,405))
arrow(d,[(1320,755),(1415,755)])
text(d,(1064,658),'Disconnected from booking',22,RED,bold=True)
d.rounded_rectangle((70,890,1715,1015),20,fill='#fff1f1',outline='#f4c7c7',width=2)
text(d,(100,915),'Observed at 200 requests/s',25,RED,bold=True)
text(d,(100,955),'38–50% HTTP failures  •  ~10 s p95  •  5,022–5,328 dropped arrivals',22,NAVY)
text(d,(100,985),'Last-seat probe: 20 confirmed bookings, 1 seat deducted. Gateway probe: 196/201 requests got 429.',20,NAVY)
im.save(OUT/'architecture-diagram-before.png',optimize=True)

im,d=canvas('AFTER  |  Current implementation + next scale step','Solid = implemented and verified locally     Dashed = proposed, not deployed or capacity-validated')
card(d,(60,275,225,390),'Client',['HTTP'],NAVY)
card(d,(300,205,540,335),'Gateway',['flight routes only','limiter unchanged'],RED)
card(d,(620,200,850,320),'Auth',['token validation'],BLUE)
card(d,(940,205,1180,350),'Flights',['search + details','atomic reservation'],GREEN)
card(d,(1260,185,1510,305),'Redis',['5-second cache','post-commit invalidation'],GREEN)
card(d,(1260,340,1510,465),'Flight MySQL',['indexed search','inventory authority'],GREEN)
card(d,(300,505,540,645),'Booking',['idempotent request','durable recovery'],GREEN)
card(d,(620,510,850,645),'Booking MySQL',['Booked + outbox','one transaction'],GREEN)
card(d,(940,515,1180,645),'RabbitMQ',['durable queue','retry + dead letter'],GREEN)
card(d,(1260,530,1510,665),'Notifications',['deduplicated inbox','SMTP worker'],GREEN)
card(d,(1540,535,1740,655),'Mailpit',['local SMTP','captured inbox'],GREEN)
card(d,(1260,715,1510,825),'Notification MySQL',['inbox + lease'],GREEN)
arrow(d,[(225,310),(260,310),(260,267),(300,267)])
arrow(d,[(540,245),(620,245)],label='auth',label_xy=(555,213))
arrow(d,[(500,335),(500,365),(900,365),(900,320),(940,320)],label='flight proxy',label_xy=(690,335))
arrow(d,[(1180,240),(1260,240)])
arrow(d,[(1180,325),(1215,325),(1215,402),(1260,402)])
arrow(d,[(225,365),(260,365),(260,575),(300,575)],label='booking direct',label_xy=(70,450))
arrow(d,[(540,575),(620,575)])
arrow(d,[(850,565),(940,565)])
text(d,(854,532),'publisher',18,MUTED)
arrow(d,[(1180,580),(1260,580)])
arrow(d,[(1510,590),(1540,590)])
arrow(d,[(1385,665),(1385,715)])
arrow(d,[(420,505),(420,415),(900,415),(900,330),(940,330)],label='reserve/release on primary',label_xy=(605,383))
text(d,(65,720),'Five services emit JSON logs, trace IDs and Prometheus metrics.',22,NAVY)
text(d,(65,752),'Prometheus + Grafana run locally. Payment service is outside the chosen scope.',20,MUTED)
d.rounded_rectangle((65,850,1735,1035),22,fill='#eef5ff',outline='#aac8f7',width=3)
text(d,(95,870),'PROPOSED AFTER ROOT-CAUSE DIAGNOSIS',24,BLUE,bold=True)
card(d,(95,920,575,1017),'Shared gateway rate policy',['before gateway replicas'],BLUE,True)
card(d,(660,920,1140,1017),'More flight/booking workers',['if saturation is measured'],BLUE,True)
card(d,(1220,920,1700,1017),'Flight read replica',['if primary reads become limiting'],BLUE,True)
im.save(OUT/'architecture-diagram-after.png',optimize=True)
print('Wrote two 1800 x 1100 architecture diagrams in docs/.')
