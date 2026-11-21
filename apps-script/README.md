# แจ้งเตือนวัน Exp. RIQAS / EQA ทางอีเมล (Google Apps Script)

สคริปต์ `ExpiryAlert.gs` อ่านปฏิทินจาก Notion (หน้า **📅 Calendar** → database *Project Schedule Calendar*)
แล้วส่งอีเมลแจ้งเตือนอัตโนมัติทุกเช้า (~07:00 น.) บนเซิร์ฟเวอร์ของ Google — ไม่ต้องเปิดคอมหรือเปิด Notion

| หมวดหมู่ (คอลัมน์ `หมวดหมู่`) | แจ้งล่วงหน้า |
|---|---|
| RIQAS QC | 3 วันก่อน `วันที่` |
| EQA | 7 วันก่อน `วันที่` |

- แต่ละรายการแจ้ง **ครั้งเดียว** (รวมหลายรายการไว้ในอีเมลฉบับเดียวต่อวัน)
- ถ้าเพิ่มรายการใหม่ใน Notion ที่เหลือไม่ถึง 3/7 วันแล้ว จะถูกแจ้งในเช้าวันถัดไป
- ถ้าแก้วันที่ของรายการ จะถือเป็นรายการใหม่และแจ้งอีกครั้ง

## ขั้นตอนติดตั้ง (ทำครั้งเดียว ~10 นาที)

### 1) สร้าง Notion Integration
1. ไปที่ <https://www.notion.so/profile/integrations> → **New integration**
2. ตั้งชื่อ เช่น `Lab Expiry Alert` เลือก workspace ที่มีหน้า LAB ON TRACK, Type = **Internal** → Save
3. Capabilities เลือกแค่ **Read content** ก็พอ
4. คัดลอก **Internal Integration Secret** (ขึ้นต้นด้วย `ntn_...`) เก็บไว้

### 2) แชร์ database ให้ integration
1. เปิดหน้า **📅 Calendar** ใน Notion → คลิกที่ตาราง *Project Schedule Calendar* → เปิดเป็นหน้าเต็ม
2. มุมขวาบน `•••` → **Connections** → เพิ่ม `Lab Expiry Alert`

### 3) สร้าง Apps Script
1. ไปที่ <https://script.google.com> (ล็อกอินบัญชี Google ที่จะใช้ส่งอีเมล) → **New project**
2. ลบโค้ดเดิม แล้ววางเนื้อหาทั้งหมดจาก `ExpiryAlert.gs` → กด 💾 Save ตั้งชื่อโปรเจกต์ เช่น `Lab Expiry Alert`
3. ⚙️ **Project Settings** → *Time zone* เลือก `(GMT+07:00) Bangkok`
4. ⚙️ **Project Settings** → เลื่อนลงไป **Script properties** → *Add script property* 2 ค่า:

   | Property | Value |
   |---|---|
   | `NOTION_TOKEN` | secret จากข้อ 1 |
   | `ALERT_EMAIL` | อีเมลผู้รับแจ้งเตือน |

### 4) ทดสอบและเปิดใช้งาน
1. กลับไปหน้า Editor เลือกฟังก์ชัน **`testSendPreview`** → ▶ Run
   - ครั้งแรกจะขออนุญาต (Review permissions → เลือกบัญชี → Advanced → Go to … → Allow)
   - ควรได้อีเมล `[ทดสอบ]` ที่รวมรายการ RIQAS/EQA ใน 30 วันข้างหน้า
2. เลือกฟังก์ชัน **`setupDailyTrigger`** → ▶ Run — เสร็จแล้ว ระบบจะรันเองทุกวัน
3. ตรวจได้ที่เมนู ⏰ **Triggers** ด้านซ้าย ต้องเห็น `checkExpiryAndNotify` — Day timer

## ปรับแต่ง
แก้ในส่วน `CONFIG` ด้านบนของไฟล์:
- `RULES` — จำนวนวันแจ้งล่วงหน้า หรือเพิ่มหมวดหมู่อื่น (ต้องตรงกับชื่อใน Notion)
- `SEND_HOUR` — ชั่วโมงที่ส่ง (แก้แล้วรัน `setupDailyTrigger` ใหม่)
- เพิ่มผู้รับ: แก้ `ALERT_EMAIL` เป็น `a@x.com,b@y.com`

ฟังก์ชัน `resetSentHistory` ใช้ล้างประวัติถ้าต้องการให้แจ้งรายการเดิมซ้ำ
