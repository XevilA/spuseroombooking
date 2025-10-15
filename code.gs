// ========================================
// ROOM BOOKING SYSTEM - SPU ENTREPRENEURSHIP
// By Arsenal - School of Entrepreneurship SPU
// WITH ADMIN APPROVAL SYSTEM
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
  
  ADMIN_EMAILS: ['admin@spu.ac.th', 'arsenal@spu.ac.th'], // เปลี่ยนเป็น email ของแอดมิน
  
  REQUIRE_APPROVAL: true, // true = ต้องอนุมัติ, false = จองได้เลย
  
  AUTO_APPROVE_DURATION: 60 // นาที - ถ้าจองน้อยกว่านี้ อนุมัติอัตโนมัติ (0 = ไม่มี auto approve)
};

// Booking Status
const BOOKING_STATUS = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก'
};

// ========================================
// WEBAPP FUNCTIONS
// ========================================

function doGet(e) {
  const page = e.parameter.page || 'user';
  
  if (page === 'admin') {
    return HtmlService.createHtmlOutputFromFile('Admin')
      .setTitle('Admin Panel - ระบบจองห้องประชุม SPU')
      .setFaviconUrl('https://img.icons8.com/color/48/000000/admin-settings-male.png')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
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
    sheet.getRange('A1:L1').setValues([[
      'ID', 'Room ID', 'Room Name', 'Date', 'Start Time', 'End Time',
      'Booker Name', 'Booker Email', 'Status', 'Approved By', 'Approved At', 'Created At'
    ]]);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#dc143c').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 12, 130);
  }
  
  return sheet;
}

function isAdmin(email) {
  return CONFIG.ADMIN_EMAILS.includes(email);
}

function shouldAutoApprove(startTime, endTime) {
  if (CONFIG.AUTO_APPROVE_DURATION === 0) return false;
  
  const duration = timeToMinutes(endTime) - timeToMinutes(startTime);
  return duration <= CONFIG.AUTO_APPROVE_DURATION;
}

// ========================================
// API FUNCTIONS
// ========================================

function getRoomsAndSlots() {
  return {
    rooms: CONFIG.ROOMS,
    timeSlots: CONFIG.TIME_SLOTS,
    requireApproval: CONFIG.REQUIRE_APPROVAL
  };
}

function getBookings(date, statusFilter = null) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const bookings = [];
  
  for (let i = 1; i < data.length; i++) {
    // กรองตามวันที่
    if (date && data[i][3] !== date) continue;
    
    // กรองตามสถานะ (ถ้ามีการระบุ)
    if (statusFilter && data[i][8] !== statusFilter) continue;
    
    bookings.push({
      id: data[i][0],
      roomId: data[i][1],
      roomName: data[i][2],
      date: data[i][3],
      startTime: data[i][4],
      endTime: data[i][5],
      bookerName: data[i][6],
      bookerEmail: data[i][7],
      status: data[i][8],
      approvedBy: data[i][9],
      approvedAt: data[i][10],
      createdAt: data[i][11]
    });
  }
  
  return bookings;
}

function createBooking(bookingData) {
  try {
    // ตรวจสอบว่ามีการจองที่อนุมัติแล้วในช่วงเวลานี้หรือไม่
    const existingBookings = getBookings(bookingData.date, BOOKING_STATUS.APPROVED);
    const isBooked = existingBookings.some(b => {
      if (b.roomId !== bookingData.roomId) return false;
      
      const newStart = timeToMinutes(bookingData.startTime);
      const newEnd = timeToMinutes(bookingData.endTime);
      const existingStart = timeToMinutes(b.startTime);
      const existingEnd = timeToMinutes(b.endTime);
      
      return (newStart < existingEnd && newEnd > existingStart);
    });
    
    if (isBooked) {
      return { 
        success: false, 
        message: 'ช่วงเวลานี้มีการจองที่อนุมัติแล้ว กรุณาเลือกช่วงเวลาอื่น' 
      };
    }
    
    // กำหนดสถานะเริ่มต้น
    let status = BOOKING_STATUS.PENDING;
    let approvedBy = '';
    let approvedAt = '';
    
    // ตรวจสอบว่าควร Auto Approve หรือไม่
    if (!CONFIG.REQUIRE_APPROVAL || shouldAutoApprove(bookingData.startTime, bookingData.endTime)) {
      status = BOOKING_STATUS.APPROVED;
      approvedBy = 'System (Auto)';
      approvedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
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
      status,
      approvedBy,
      approvedAt,
      timestamp
    ]);
    
    // ถ้าอนุมัติแล้ว ให้เพิ่มลง Calendar
    if (status === BOOKING_STATUS.APPROVED) {
      addToCalendar(bookingData, room.name, id);
    }
    
    // ส่งการแจ้งเตือน
    if (status === BOOKING_STATUS.PENDING) {
      sendLineNotificationToAdmin(bookingData, room.name, id);
      sendLineNotificationToUser(bookingData, room.name, 'pending');
    } else {
      sendLineNotificationToUser(bookingData, room.name, 'approved');
    }
    
    const message = status === BOOKING_STATUS.APPROVED 
      ? 'จองห้องสำเร็จและอนุมัติแล้ว! ✅' 
      : 'ส่งคำขอจองสำเร็จ! รอการอนุมัติจากแอดมิน ⏳';
    
    return { 
      success: true, 
      message: message,
      bookingId: id,
      status: status
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
        if (data[i][7] === userEmail || isAdmin(userEmail)) {
          const bookingInfo = {
            roomName: data[i][2],
            date: data[i][3],
            startTime: data[i][4],
            endTime: data[i][5],
            bookerName: data[i][6],
            status: data[i][8]
          };
          
          // อัพเดทสถานะเป็น ยกเลิก แทนการลบ
          sheet.getRange(i + 1, 9).setValue(BOOKING_STATUS.CANCELLED);
          
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
// ADMIN FUNCTIONS
// ========================================

function verifyAdmin(email) {
  return {
    isAdmin: isAdmin(email),
    email: email
  };
}

function getPendingBookings() {
  const allBookings = getBookings(null, BOOKING_STATUS.PENDING);
  
  // เรียงตามวันที่และเวลา
  allBookings.sort((a, b) => {
    const dateCompare = new Date(a.date) - new Date(b.date);
    if (dateCompare !== 0) return dateCompare;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
  
  return allBookings;
}

function getAllBookingsForAdmin() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const bookings = [];
  
  for (let i = 1; i < data.length; i++) {
    // ไม่แสดงรายการที่ยกเลิก
    if (data[i][8] === BOOKING_STATUS.CANCELLED) continue;
    
    bookings.push({
      id: data[i][0],
      roomId: data[i][1],
      roomName: data[i][2],
      date: data[i][3],
      startTime: data[i][4],
      endTime: data[i][5],
      bookerName: data[i][6],
      bookerEmail: data[i][7],
      status: data[i][8],
      approvedBy: data[i][9],
      approvedAt: data[i][10],
      createdAt: data[i][11]
    });
  }
  
  // เรียงตามวันที่ล่าสุด
  bookings.sort((a, b) => {
    const dateCompare = new Date(b.date) - new Date(a.date);
    if (dateCompare !== 0) return dateCompare;
    return timeToMinutes(b.startTime) - timeToMinutes(a.startTime);
  });
  
  return bookings;
}

function approveBooking(bookingId, adminEmail) {
  try {
    if (!isAdmin(adminEmail)) {
      return {
        success: false,
        message: 'คุณไม่มีสิทธิ์อนุมัติการจอง'
      };
    }
    
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === bookingId) {
        // ตรวจสอบสถานะปัจจุบัน
        if (data[i][8] !== BOOKING_STATUS.PENDING) {
          return {
            success: false,
            message: 'ไม่สามารถอนุมัติได้ เนื่องจากสถานะไม่ใช่ "รออนุมัติ"'
          };
        }
        
        // ตรวจสอบว่ามีการจองที่อนุมัติแล้วในช่วงเวลานี้หรือไม่
        const bookingData = {
          roomId: data[i][1],
          date: data[i][3],
          startTime: data[i][4],
          endTime: data[i][5]
        };
        
        const existingBookings = getBookings(bookingData.date, BOOKING_STATUS.APPROVED);
        const isBooked = existingBookings.some(b => {
          if (b.roomId !== bookingData.roomId || b.id === bookingId) return false;
          
          const newStart = timeToMinutes(bookingData.startTime);
          const newEnd = timeToMinutes(bookingData.endTime);
          const existingStart = timeToMinutes(b.startTime);
          const existingEnd = timeToMinutes(b.endTime);
          
          return (newStart < existingEnd && newEnd > existingStart);
        });
        
        if (isBooked) {
          return {
            success: false,
            message: 'ไม่สามารถอนุมัติได้ เนื่องจากมีการจองอื่นที่อนุมัติแล้วในช่วงเวลานี้'
          };
        }
        
        // อัพเดทสถานะ
        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        sheet.getRange(i + 1, 9).setValue(BOOKING_STATUS.APPROVED);
        sheet.getRange(i + 1, 10).setValue(adminEmail);
        sheet.getRange(i + 1, 11).setValue(timestamp);
        
        // เพิ่มลง Google Calendar
        const room = CONFIG.ROOMS.find(r => r.id === data[i][1]);
        addToCalendar({
          roomId: data[i][1],
          date: data[i][3],
          startTime: data[i][4],
          endTime: data[i][5],
          bookerName: data[i][6],
          bookerEmail: data[i][7]
        }, room.name, bookingId);
        
        // ส่งการแจ้งเตือน
        sendLineApprovalNotification({
          roomName: data[i][2],
          date: data[i][3],
          startTime: data[i][4],
          endTime: data[i][5],
          bookerName: data[i][6],
          bookerEmail: data[i][7],
          approvedBy: adminEmail
        });
        
        return {
          success: true,
          message: 'อนุมัติการจองสำเร็จ'
        };
      }
    }
    
    return {
      success: false,
      message: 'ไม่พบการจองนี้'
    };
    
  } catch (error) {
    Logger.log('Error approving booking: ' + error);
    return {
      success: false,
      message: 'เกิดข้อผิดพลาด: ' + error.toString()
    };
  }
}

function rejectBooking(bookingId, adminEmail, reason) {
  try {
    if (!isAdmin(adminEmail)) {
      return {
        success: false,
        message: 'คุณไม่มีสิทธิ์ปฏิเสธการจอง'
      };
    }
    
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === bookingId) {
        // ตรวจสอบสถานะปัจจุบัน
        if (data[i][8] !== BOOKING_STATUS.PENDING) {
          return {
            success: false,
            message: 'ไม่สามารถปฏิเสธได้ เนื่องจากสถานะไม่ใช่ "รออนุมัติ"'
          };
        }
        
        // อัพเดทสถานะ
        const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        sheet.getRange(i + 1, 9).setValue(BOOKING_STATUS.REJECTED);
        sheet.getRange(i + 1, 10).setValue(adminEmail);
        sheet.getRange(i + 1, 11).setValue(timestamp);
        
        // ส่งการแจ้งเตือน
        sendLineRejectionNotification({
          roomName: data[i][2],
          date: data[i][3],
          startTime: data[i][4],
          endTime: data[i][5],
          bookerName: data[i][6],
          bookerEmail: data[i][7],
          rejectedBy: adminEmail,
          reason: reason
        });
        
        return {
          success: true,
          message: 'ปฏิเสธการจองสำเร็จ'
        };
      }
    }
    
    return {
      success: false,
      message: 'ไม่พบการจองนี้'
    };
    
  } catch (error) {
    Logger.log('Error rejecting booking: ' + error);
    return {
      success: false,
      message: 'เกิดข้อผิดพลาด: ' + error.toString()
    };
  }
}

function getBookingStats() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  const stats = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    todayBookings: 0,
    upcomingBookings: 0
  };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = Utilities.formatDate(today, 'Asia/Bangkok', 'yyyy-MM-dd');
  
  for (let i = 1; i < data.length; i++) {
    stats.total++;
    
    const status = data[i][8];
    const bookingDate = data[i][3];
    
    if (status === BOOKING_STATUS.PENDING) stats.pending++;
    if (status === BOOKING_STATUS.APPROVED) stats.approved++;
    if (status === BOOKING_STATUS.REJECTED) stats.rejected++;
    if (status === BOOKING_STATUS.CANCELLED) stats.cancelled++;
    
    if (bookingDate === todayStr && status === BOOKING_STATUS.APPROVED) {
      stats.todayBookings++;
    }
    
    if (new Date(bookingDate) >= today && status === BOOKING_STATUS.APPROVED) {
      stats.upcomingBookings++;
    }
  }
  
  return stats;
}

// ========================================
// GOOGLE CALENDAR INTEGRATION
// ========================================

function addToCalendar(bookingData, roomName, bookingId) {
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
        description: `ผู้จอง: ${bookingData.bookerName}\nอีเมล: ${bookingData.bookerEmail}\nBooking ID: ${bookingId}\n\nจองผ่าน School of Entrepreneurship SPU Booking System`,
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

function sendLineNotificationToAdmin(bookingData, roomName, bookingId) {
  try {
    const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
      Logger.log('LINE token not configured');
      return;
    }
    
    const message = `
🔔 มีคำขอจองห้องใหม่!

📍 ห้อง: ${roomName}
📅 วันที่: ${formatThaiDate(bookingData.date)}
⏰ เวลา: ${bookingData.startTime} - ${bookingData.endTime}
👤 ผู้จอง: ${bookingData.bookerName}
📧 อีเมล: ${bookingData.bookerEmail}

⏳ สถานะ: รออนุมัติ

กรุณาเข้าไปอนุมัติที่:
Admin Panel

---
School of Entrepreneurship SPU
By Arsenal 🎯
    `.trim();
    
    sendLineMessage(message);
    
  } catch (error) {
    Logger.log('Error sending LINE notification to admin: ' + error);
  }
}

function sendLineNotificationToUser(bookingData, roomName, type) {
  try {
    const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
      return;
    }
    
    let message = '';
    
    if (type === 'pending') {
      message = `
⏳ ส่งคำขอจองห้องสำเร็จ!

📍 ห้อง: ${roomName}
📅 วันที่: ${formatThaiDate(bookingData.date)}
⏰ เวลา: ${bookingData.startTime} - ${bookingData.endTime}
👤 ผู้จอง: ${bookingData.bookerName}

สถานะ: รอการอนุมัติจากแอดมิน
คุณจะได้รับการแจ้งเตือนเมื่อมีการอนุมัติ

---
School of Entrepreneurship SPU
      `.trim();
    } else if (type === 'approved') {
      message = `
✅ จองห้องสำเร็จ! (อนุมัติอัตโนมัติ)

📍 ห้อง: ${roomName}
📅 วันที่: ${formatThaiDate(bookingData.date)}
⏰ เวลา: ${bookingData.startTime} - ${bookingData.endTime}
👤 ผู้จอง: ${bookingData.bookerName}

การจองของคุณได้รับการอนุมัติแล้ว!
คุณจะได้รับ Google Calendar Event

---
School of Entrepreneurship SPU
By Arsenal 🎯
      `.trim();
    }
    
    sendLineMessage(message);
    
  } catch (error) {
    Logger.log('Error sending LINE notification to user: ' + error);
  }
}

function sendLineApprovalNotification(bookingInfo) {
  try {
    const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
      return;
    }
    
    const message = `
✅ การจองของคุณได้รับการอนุมัติแล้ว!

📍 ห้อง: ${bookingInfo.roomName}
📅 วันที่: ${formatThaiDate(bookingInfo.date)}
⏰ เวลา: ${bookingInfo.startTime} - ${bookingInfo.endTime}
👤 ผู้จอง: ${bookingInfo.bookerName}

อนุมัติโดย: ${bookingInfo.approvedBy}

คุณจะได้รับ Google Calendar Event
กรุณามาถึงก่อนเวลา 5 นาที

---
School of Entrepreneurship SPU
By Arsenal 🎯
    `.trim();
    
    sendLineMessage(message);
    
  } catch (error) {
    Logger.log('Error sending LINE approval notification: ' + error);
  }
}

function sendLineRejectionNotification(bookingInfo) {
  try {
    const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (token === 'YOUR_LINE_CHANNEL_ACCESS_TOKEN') {
      return;
    }
    
    const message = `
❌ การจองของคุณถูกปฏิเสธ

📍 ห้อง: ${bookingInfo.roomName}
📅 วันที่: ${formatThaiDate(bookingInfo.date)}
⏰ เวลา: ${bookingInfo.startTime} - ${bookingInfo.endTime}
👤 ผู้จอง: ${bookingInfo.bookerName}

เหตุผล: ${bookingInfo.reason || 'ไม่ระบุ'}

คุณสามารถจองใหม่ในช่วงเวลาอื่นได้

---
School of Entrepreneurship SPU
    `.trim();
    
    sendLineMessage(message);
    
  } catch (error) {
    Logger.log('Error sending LINE rejection notification: ' + error);
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
    
    sendLineMessage(message);
    
  } catch (error) {
    Logger.log('Error sending LINE cancellation: ' + error);
  }
}

function sendLineMessage(message) {
  const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
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
    if (data[i][7] === userEmail && data[i][8] !== BOOKING_STATUS.CANCELLED) {
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
          bookerEmail: data[i][7],
          status: data[i][8],
          approvedBy: data[i][9],
          approvedAt: data[i][10]
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
    const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    const bookings = getBookings(today, BOOKING_STATUS.APPROVED);
    
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
    
    // แสดงจำนวนรออนุมัติ
    const pending = getPendingBookings().length;
    if (pending > 0) {
      replyMessage += `⏳ รออนุมัติ: ${pending} รายการ\n\n`;
    }
    
    replyMessage += '\n📲 จองเลย: [ใส่ URL ของ WebApp]';
    
  } else if (userMessage.includes('วิธีจอง') || userMessage.includes('จองยังไง')) {
    replyMessage = `
📝 วิธีการจองห้อง:

1. เปิดระบบจอง: [ใส่ URL]
2. เลือกห้องที่ต้องการ
3. เลือกวันที่
4. เลือกเวลาเริ่มต้นและสิ้นสุด
5. กรอกชื่อและอีเมล
6. กดยืนยันการจอง

${CONFIG.REQUIRE_APPROVAL ? '⏳ การจองจะต้องรอการอนุมัติจากแอดมิน\n(การจองสั้นๆ จะอนุมัติอัตโนมัติ)' : '✅ การจองจะได้รับการอนุมัติทันที'}

⏰ เวลาทำการ: 09:00-18:30 น.
    `.trim();
    
  } else {
    replyMessage = `
สวัสดีค่ะ! 👋

ระบบจองห้อง SPU
School of Entrepreneurship

คำสั่ง:
💡 "ห้องว่าง" - ดูสถานะห้อง
💡 "วิธีจอง" - คู่มือการจอง

📲 จองเลย: [URL]

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
