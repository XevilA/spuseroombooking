// ========================================
// ROOM BOOKING SYSTEM - SPU ENTREPRENEURSHIP
// By Arsenal - School of Entrepreneurship SPU
// ========================================

// ตั้งค่าระบบ
const CONFIG = {
  SHEET_NAME: 'Bookings',
  CALENDAR_ID: 'primary', // เปลี่ยนเป็น Calendar ID ของคุณ
  LINE_CHANNEL_ACCESS_TOKEN: 'YOUR_LINE_CHANNEL_ACCESS_TOKEN', // ใส่ TOKEN จาก LINE Developers
  
  ROOMS: [
    { id: 1, name: 'ห้องประชุมคณะการสร้างเจ้าของธุรกิจ', color: '#dc143c', icon: '🏢' },
    { id: 2, name: 'ห้อง Coaching', color: '#b22222', icon: '💼' }
  ],
  
  TIME_SLOTS: generateTimeSlots('09:00', '18:30', 30),
  
  ADMIN_EMAILS: ['admin@spu.ac.th'] // เปลี่ยนเป็น email ของแอดมิน
};

// ========================================
// WEBAPP FUNCTIONS
// ========================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบจองห้องประชุม - School of Entrepreneurship SPU')
    .setFaviconUrl('https://img.icons8.com/color/48/000000/calendar--v1.png')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function generateTimeSlots(startTime, endTime, intervalMinutes) {
  const slots = [];
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let currentTime = startHour * 60 + startMin;
  const endTimeInMinutes = endHour * 60 + endMin;
  
  while (currentTime < endTimeInMinutes) {
    const hours = Math.floor(currentTime / 60);
    const minutes = currentTime % 60;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    slots.push(timeStr);
    currentTime += intervalMinutes;
  }
  
  return slots;
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange('A1:I1').setValues([[
      'ID', 'Room ID', 'Room Name', 'Date', 'Start Time', 'End Time',
      'Booker Name', 'Booker Email', 'Created At'
    ]]);
    sheet.getRange('A1:I1').setFontWeight('bold').setBackground('#dc143c').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 9, 150);
  }
  
  return sheet;
}

// ========================================
// API FUNCTIONS
// ========================================

function getRoomsAndSlots() {
  return {
    rooms: CONFIG.ROOMS,
    timeSlots: CONFIG.TIME_SLOTS
  };
}

function getBookings(date) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const bookings = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === date) {
      bookings.push({
        id: data[i][0],
        roomId: data[i][1],
        roomName: data[i][2],
        date: data[i][3],
        startTime: data[i][4],
        endTime: data[i][5],
        bookerName: data[i][6],
        bookerEmail: data[i][7],
        createdAt: data[i][8]
      });
    }
  }
  
  return bookings;
}

function createBooking(bookingData) {
  try {
    // ตรวจสอบว่ามีการจองในช่วงเวลานี้แล้วหรือไม่
    const existingBookings = getBookings(bookingData.date);
    const isBooked = existingBookings.some(b => {
      if (b.roomId !== bookingData.roomId) return false;
      
      // ตรวจสอบว่าช่วงเวลาทับซ้อนกันหรือไม่
      const newStart = timeToMinutes(bookingData.startTime);
      const newEnd = timeToMinutes(bookingData.endTime);
      const existingStart = timeToMinutes(b.startTime);
      const existingEnd = timeToMinutes(b.endTime);
      
      return (newStart < existingEnd && newEnd > existingStart);
    });
    
    if (isBooked) {
      return { 
        success: false, 
        message: 'ช่วงเวลานี้มีการจองแล้ว กรุณาเลือกช่วงเวลาอื่น' 
      };
    }
    
    // บันทึกการจอง
    const sheet = getOrCreateSheet();
    const id = Utilities.getUuid();
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    
    const room = CONFIG.ROOMS.find(r => r.id === bookingData.roomId);
    
    sheet.appendRow([
      id,
      bookingData.roomId,
      room.name,
      bookingData.date,
      bookingData.startTime,
      bookingData.endTime,
      bookingData.bookerName,
      bookingData.bookerEmail,
      timestamp
    ]);
    
    // เพิ่มลงใน Google Calendar
    const calendarEventId = addToCalendar(bookingData, room.name);
    
    // ส่งการแจ้งเตือนผ่าน LINE
    sendLineNotification(bookingData, room.name);
    
    return { 
      success: true, 
      message: 'จองห้องสำเร็จ! ✅',
      bookingId: id,
      calendarEventId: calendarEventId
    };
    
  } catch (error) {
    Logger.log('Error creating booking: ' + error);
    return { 
      success: false, 
      message: 'เกิดข้อผิดพลาด: ' + error.toString() 
    };
  }
}

function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function cancelBooking(bookingId, userEmail) {
  try {
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === bookingId) {
        // ตรวจสอบว่าเป็นเจ้าของการจองหรือแอดมิน
        if (data[i][7] === userEmail || CONFIG.ADMIN_EMAILS.includes(userEmail)) {
          const bookingInfo = {
            roomName: data[i][2],
            date: data[i][3],
            startTime: data[i][4],
            endTime: data[i][5],
            bookerName: data[i][6]
          };
          
          sheet.deleteRow(i + 1);
          
          // ส่งการแจ้งเตือนการยกเลิก
          sendLineCancellationNotification(bookingInfo);
          
          return { 
            success: true, 
            message: 'ยกเลิกการจองสำเร็จ' 
          };
        } else {
          return { 
            success: false, 
            message: 'คุณไม่มีสิทธิ์ยกเลิกการจองนี้' 
          };
        }
      }
    }
    
    return { 
      success: false, 
      message: 'ไม่พบการจองนี้' 
    };
    
  } catch (error) {
    Logger.log('Error canceling booking: ' + error);
    return { 
      success: false, 
      message: 'เกิดข้อผิดพลาด: ' + error.toString() 
    };
  }
}

// ========================================
// GOOGLE CALENDAR INTEGRATION
// ========================================

function addToCalendar(bookingData, roomName) {
  try {
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    if (!calendar) {
      Logger.log('Calendar not found: ' + CONFIG.CALENDAR_ID);
      return null;
    }
    
    const [year, month, day] = bookingData.date.split('-');
    const [startHours, startMinutes] = bookingData.startTime.split(':');
    const [endHours, endMinutes] = bookingData.endTime.split(':');
    
    const startTime = new Date(year, month - 1, day, startHours, startMinutes);
    const endTime = new Date(year, month - 1, day, endHours, endMinutes);
    
    const event = calendar.createEvent(
      `🏫 ${roomName}`,
      startTime,
      endTime,
      {
        description: `ผู้จอง: ${bookingData.bookerName}\nอีเมล: ${bookingData.bookerEmail}\n\nจองผ่าน School of Entrepreneurship SPU Booking System`,
        location: roomName,
        guests: bookingData.bookerEmail,
        sendInvites: true
      }
    );
    
    Logger.log('Calendar event created: ' + event.getId());
    return event.getId();
    
  } catch (error) {
    Logger.log('Error adding to calendar: ' + error);
    return null;
  }
}

// ========================================
// LINE MESSAGING API INTEGRATION
// ========================================

function sendLineNotification(bookingData, roomName) {
  try {
    const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
      Logger.log('LINE token not configured');
      return;
    }
    
    const message = `
🎉 มีการจองห้องใหม่!

📍 ห้อง: ${roomName}
📅 วันที่: ${formatThaiDate(bookingData.date)}
⏰ เวลา: ${bookingData.startTime} - ${bookingData.endTime}
👤 ผู้จอง: ${bookingData.bookerName}
📧 อีเมล: ${bookingData.bookerEmail}

---
School of Entrepreneurship SPU
By Arsenal 🎯
    `.trim();
    
    // Broadcast message to all followers
    const url = 'https://api.line.me/v2/bot/message/broadcast';
    
    const payload = {
      messages: [{
        type: 'text',
        text: message
      }]
    };
    
    const options = {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    Logger.log('LINE notification sent: ' + response.getContentText());
    
  } catch (error) {
    Logger.log('Error sending LINE notification: ' + error);
  }
}

function sendLineCancellationNotification(bookingInfo) {
  try {
    const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
      return;
    }
    
    const message = `
❌ มีการยกเลิกการจอง

📍 ห้อง: ${bookingInfo.roomName}
📅 วันที่: ${formatThaiDate(bookingInfo.date)}
⏰ เวลา: ${bookingInfo.startTime} - ${bookingInfo.endTime}
👤 ผู้จอง: ${bookingInfo.bookerName}

ห้องนี้ว่างแล้ว สามารถจองได้!

---
School of Entrepreneurship SPU
    `.trim();
    
    const url = 'https://api.line.me/v2/bot/message/broadcast';
    
    const payload = {
      messages: [{
        type: 'text',
        text: message
      }]
    };
    
    const options = {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    UrlFetchApp.fetch(url, options);
    
  } catch (error) {
    Logger.log('Error sending LINE cancellation: ' + error);
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function formatThaiDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  
  return `${day} ${thaiMonths[parseInt(month) - 1]} ${parseInt(year) + 543}`;
}

function getUserBookings(userEmail) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const bookings = [];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === userEmail) {
      const bookingDate = new Date(data[i][3]);
      
      // แสดงเฉพาะการจองในอนาคตและวันนี้
      if (bookingDate >= today) {
        bookings.push({
          id: data[i][0],
          roomId: data[i][1],
          roomName: data[i][2],
          date: data[i][3],
          startTime: data[i][4],
          endTime: data[i][5],
          bookerName: data[i][6],
          bookerEmail: data[i][7]
        });
      }
    }
  }
  
  // เรียงตามวันที่และเวลา
  bookings.sort((a, b) => {
    const dateCompare = new Date(a.date) - new Date(b.date);
    if (dateCompare !== 0) return dateCompare;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
  
  return bookings;
}

function getAllBookingsForDate(date) {
  const bookings = getBookings(date);
  
  // เรียงตามห้องและเวลา
  bookings.sort((a, b) => {
    const roomCompare = a.roomId - b.roomId;
    if (roomCompare !== 0) return roomCompare;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
  
  return bookings;
}

// ========================================
// LINE WEBHOOK (for LINE OA chatbot)
// ========================================

function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);
    const events = json.events;
    
    for (let event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        handleLineMessage(event);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: 'ok'}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log('Error in doPost: ' + error);
    return ContentService.createTextOutput(JSON.stringify({status: 'error'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleLineMessage(event) {
  const replyToken = event.replyToken;
  const userMessage = event.message.text.toLowerCase();
  
  let replyMessage = '';
  
  if (userMessage.includes('ห้องว่าง') || userMessage.includes('ว่าง')) {
    // ตรวจสอบห้องว่าง
    const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    const bookings = getBookings(today);
    
    replyMessage = `📊 สถานะห้องวันนี้ (${formatThaiDate(today)})\n\n`;
    
    CONFIG.ROOMS.forEach(room => {
      const roomBookings = bookings.filter(b => b.roomId === room.id);
      const bookedSlots = [];
      
      roomBookings.forEach(b => {
        bookedSlots.push(`${b.startTime}-${b.endTime}`);
      });
      
      replyMessage += `${room.icon} ${room.name}\n`;
      if (bookedSlots.length > 0) {
        replyMessage += `   จองแล้ว: ${bookedSlots.join(', ')}\n`;
      } else {
        replyMessage += `   ✅ ว่างทั้งวัน!\n`;
      }
      replyMessage += '\n';
    });
    
    replyMessage += '\n📲 จองเลย: [ใส่ URL ของ WebApp]';
    
  } else if (userMessage.includes('วิธีจอง') || userMessage.includes('จองยังไง')) {
    replyMessage = `
📝 วิธีการจองห้อง:

1. เปิดระบบจอง: [ใส่ URL ของ WebApp]
2. เลือกห้องที่ต้องการ
3. เลือกวันที่
4. เลือกเวลาเริ่มต้นและสิ้นสุด
5. กรอกชื่อและอีเมล
6. กดยืนยันการจอง ✅

ระบบจะแจ้งเตือนทาง LINE และส่ง Google Calendar Event ให้อัตโนมัติ!

⏰ เวลาทำการ: 09:00-18:30 น.
📅 จองได้ล่วงหน้า
    `.trim();
    
  } else {
    replyMessage = `
สวัสดีค่ะ! 👋

ฉันคือระบบจองห้อง
School of Entrepreneurship SPU

คำสั่งที่ใช้ได้:
💡 "ห้องว่าง" - ดูสถานะห้องวันนี้
💡 "วิธีจอง" - คู่มือการจองห้อง

📲 จองเลย: [ใส่ URL ของ WebApp]

By Arsenal 🎯
    `.trim();
  }
  
  replyToLine(replyToken, replyMessage);
}

function replyToLine(replyToken, message) {
  const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
  
  if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
    return;
  }
  
  const url = 'https://api.line.me/v2/bot/message/reply';
  
  const payload = {
    replyToken: replyToken,
    messages: [{
      type: 'text',
      text: message
    }]
  };
  
  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(url, options);
}

// ========================================
// TEST FUNCTIONS
// ========================================

function testCreateBooking() {
  const testData = {
    roomId: 1,
    date: '2024-10-15',
    startTime: '10:00',
    endTime: '11:00',
    bookerName: 'Test User',
    bookerEmail: 'test@example.com'
  };
  
  const result = createBooking(testData);
  Logger.log(result);
}

function testGetBookings() {
  const bookings = getBookings('2024-10-15');
  Logger.log(bookings);
}
