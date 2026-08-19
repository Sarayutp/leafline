# Leafline

Leafline คือ RSS reader ส่วนตัวสำหรับผู้ใช้คนเดียว ออกแบบให้ใช้งานบน MacBook, Tablet และ iPhone โดยซิงก์สถานะอ่านแล้วและ Bookmark ผ่าน Cloudflare D1 หน้าเว็บโฮสต์ฟรีบน GitHub Pages และไม่ต้องมีระบบสมาชิก

## ฟีเจอร์

- เพิ่ม RSS/Atom feed และจัดหมวดหมู่
- อ่านแบบสามคอลัมน์บนเดสก์ท็อป และหน้าจอเดียวบนมือถือ
- ซิงก์ข่าวที่อ่านแล้วและ Bookmark ระหว่างอุปกรณ์
- เชื่อมอุปกรณ์ใหม่ด้วย QR หรือลิงก์ครั้งเดียว ไม่ต้อง Login ทุกครั้ง
- ค้นหา ซ่อนข่าวที่อ่านแล้ว และทำเครื่องหมายอ่านทั้งหมด
- Dark mode และติดตั้งบน Home Screen ได้
- เก็บ snapshot ล่าสุดไว้ใน IndexedDB สำหรับเปิดอ่านตอนออฟไลน์
- ดึง RSS อัตโนมัติทุก 30 นาทีด้วย Cloudflare Cron Trigger
- โหลดเนื้อหาเต็มพร้อมรูปจาก iMoD เมื่อเปิดอ่านครั้งแรก และแคชไว้ใช้ข้ามอุปกรณ์
- กดปุ่มลูกศรลงเพื่อเปิดอ่านข่าวถัดไปทันที
- ปัดซ้ายหรือขวาใน Reader เพื่อเปลี่ยนข่าวบนมือถือและแท็บเล็ต

## สถาปัตยกรรม

```text
GitHub Pages (React + Vite)
          │ Bearer sync token
          ▼
Cloudflare Worker ─── RSS/Atom websites
          │
          ▼
Cloudflare D1 (feeds, articles, read state, bookmarks)
```

รหัสซิงก์จริงอยู่บนอุปกรณ์เท่านั้น D1 เก็บเฉพาะ SHA-256 hash และลิงก์จับคู่เก็บรหัสไว้ใน URL fragment ซึ่งไม่ถูกส่งให้ GitHub Pages

## ทดลองในเครื่อง

ต้องมี Node.js 22 ขึ้นไป

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
```

เปิดสอง Terminal:

```bash
npm run dev:worker
```

```bash
npm run dev
```

จากนั้นเปิด `http://localhost:5173` และใช้ค่าเหล่านี้:

- Worker URL: `http://localhost:8787`
- Setup secret: ค่าที่กำหนดไว้ใน `.dev.vars`

## Deploy Cloudflare Worker + D1

### 1. Login และสร้าง D1

```bash
npx wrangler login
npx wrangler d1 create leafline-db
```

คัดลอก `database_id` ที่ได้ไปแทน `REPLACE_WITH_YOUR_D1_DATABASE_ID` ใน `wrangler.jsonc`

### 2. อนุญาต GitHub Pages origin

แก้ `ALLOWED_ORIGINS` ใน `wrangler.jsonc` เป็น origin ของ GitHub Pages เช่น:

```json
"ALLOWED_ORIGINS": "https://YOUR_GITHUB_USERNAME.github.io"
```

ถ้าต้องการเปิดจาก local development ด้วย ให้คั่นหลาย origin ด้วย comma:

```json
"ALLOWED_ORIGINS": "https://YOUR_GITHUB_USERNAME.github.io,http://localhost:5173"
```

ใส่เฉพาะ origin ไม่ต้องใส่ชื่อ repository ต่อท้าย

### 3. สร้างรหัสตั้งต้น

```bash
npx wrangler secret put SETUP_SECRET
```

ใส่รหัสยาวที่เดายากและเก็บไว้ใน password manager รหัสนี้ใช้เฉพาะตอนตั้งค่าเครื่องแรก ห้ามเขียนลงใน repository

### 4. สร้างตารางและ deploy

```bash
npm run db:migrate:remote
npm run deploy:worker
```

หลัง deploy สำเร็จ Wrangler จะแสดง URL ประมาณนี้:

```text
https://leafline-api.YOUR_SUBDOMAIN.workers.dev
```

ทดสอบได้ที่ `https://...workers.dev/api/health`

## Deploy GitHub Pages

โปรเจกต์มี workflow ที่ `.github/workflows/pages.yml` พร้อมใช้งานแล้ว

1. สร้าง public repository บน GitHub แล้ว push โปรเจกต์นี้ขึ้น branch `main`
2. ไปที่ **Settings → Secrets and variables → Actions → Variables**
3. เพิ่ม Repository variable ชื่อ `VITE_API_URL` โดยใส่ URL ของ Worker
4. ไปที่ **Settings → Pages** และเลือก Source เป็น **GitHub Actions**
5. Run workflow `Deploy Leafline to GitHub Pages` หรือ push เข้า `main` อีกครั้ง

หน้าเว็บจะอยู่ที่:

```text
https://YOUR_GITHUB_USERNAME.github.io/REPOSITORY_NAME/
```

หากไม่ตั้ง `VITE_API_URL` หน้า onboarding ยังสามารถให้กรอก Worker URL เองได้

## ตั้งค่าและเชื่อมสามอุปกรณ์

1. เปิด GitHub Pages บน MacBook
2. เลือก **เครื่องแรก** แล้วกรอก Worker URL และ `SETUP_SECRET`
3. ไปที่ **ตั้งค่า → อุปกรณ์และซิงก์**
4. ใช้กล้อง iPhone/Tablet สแกน QR จากหน้าจอ MacBook
5. เปิดลิงก์ที่สแกน อุปกรณ์ใหม่จะเริ่มซิงก์ทันที

ทุกอุปกรณ์จะตรวจข้อมูลใหม่เมื่อกลับมาเปิดหน้าเว็บ และขณะใช้งานจะซิงก์ทุก 30 วินาที

## คำสั่งที่ใช้บ่อย

```bash
npm run check             # ตรวจ TypeScript ทั้ง frontend และ Worker
npm run build             # สร้าง production build
npm run dev               # รัน frontend
npm run dev:worker        # รัน Worker + D1 ในเครื่อง
npm run db:migrate:local  # apply migration ในเครื่อง
npm run db:migrate:remote # apply migration บน Cloudflare
npm run deploy:worker     # deploy Worker
```

## ข้อควรระวัง

- Sync code มีสิทธิ์อ่านและแก้ข้อมูลทั้งหมด ให้ถือว่าเป็นรหัสผ่านและไม่แชร์ QR screenshot
- หาก Sync code รั่วหรืออุปกรณ์สูญหาย ให้ไปที่ **ตั้งค่า → อุปกรณ์และซิงก์ → ยกเลิกอุปกรณ์อื่นและสร้างรหัสใหม่** แล้วจับคู่อุปกรณ์ที่ยังใช้งานอีกครั้ง
- รูปภาพบทความโหลดจากเว็บไซต์ต้นทางโดยตรง แต่ตั้ง `no-referrer` ไว้เพื่อลดข้อมูลที่ส่งกลับ
- GitHub Pages และ Cloudflare Free เหมาะกับการใช้งานส่วนตัวนี้ แต่ควรตรวจโควตาจาก dashboard เป็นระยะ
