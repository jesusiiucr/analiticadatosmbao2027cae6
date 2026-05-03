/**
 * ==========================================
 * BACKEND DE ANALYTICS PARA ANALITICA DE DATOS
 * Google Apps Script - Despliegue como Web App
 * ==========================================
 * 
 * INSTRUCCIONES DE INSTALACION:
 * 1. Ve a https://script.google.com
 * 2. Crea un nuevo proyecto (o abre el existente con tu webhook)
 * 3. Borra TODO el contenido del editor y pega este codigo completo
 * 4. Guarda (Ctrl+S) con nombre: "Analytics Backend"
 * 5. Haz clic en "Implementar" > "Nueva implementacion" > Selecciona tipo "Aplicacion web"
 * 6. Configura:
 *    - Descripcion: "Analytics API"
 *    - Ejecutar como: "Yo" (tu cuenta)
 *    - Acceso: "Cualquiera" (o "Cualquiera, incluso anonimo" para que funcione desde cualquier dispositivo)
 * 7. Copia la URL de la aplicacion web y reemplazala en tu HTML en la variable FALLBACK_WEBHOOK
 * 
 * ESTRUCTURA DE HOJAS (se crean automaticamente al primer uso):
 * - Sheet "Visitas": timestamp, ip, pais, userAgent, tiempoTotal
 * - Sheet "Quizzes": timestamp, ip, pais, modulo, pregunta, tipo, correcto, tiempoTotal
 * - Sheet "Paises": pais, conteo (se actualiza automaticamente)
 */

const SHEET_NAME_VISITAS = 'Visitas';
const SHEET_NAME_QUIZZES = 'Quizzes';
const SHEET_NAME_PAISES = 'Paises';

// ==========================================
// FUNCION PRINCIPAL - Maneja GET y POST
// ==========================================
function doGet(e) {
  try {
    var action = e.parameter.action;
    
    if (action === 'getGlobalMetrics') {
      return jsonResponse(getGlobalMetrics());
    }
    
    if (action === 'getCountries') {
      return jsonResponse(getCountries());
    }
    
    // Default: devolver metricas
    return jsonResponse(getGlobalMetrics());
    
  } catch (err) {
    return jsonResponse({error: err.toString()}, 500);
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var event = data.event || 'unknown';
    
    if (event === 'visit') {
      recordVisit(data);
    } else if (event === 'quiz') {
      recordQuiz(data);
    }
    
    return jsonResponse({success: true, received: event});
    
  } catch (err) {
    // Intentar registrar el error
    try {
      var ss = getOrCreateSpreadsheet();
      var sheet = getOrCreateSheet(ss, 'Errores', ['timestamp', 'error', 'payload']);
      sheet.appendRow([new Date(), err.toString(), e.postData ? e.postData.contents : 'no payload']);
    } catch(e2) {}
    
    return jsonResponse({success: false, error: err.toString()}, 500);
  }
}

// ==========================================
// REGISTRO DE DATOS
// ==========================================
function recordVisit(data) {
  var ss = getOrCreateSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEET_NAME_VISITAS, ['timestamp', 'ip', 'pais', 'userAgent', 'tiempoTotal']);
  
  sheet.appendRow([
    new Date(),
    data.ip || 'desconocido',
    data.country || 'desconocido',
    data.ua || '',
    data.timeTotal || 0
  ]);
  
  // Actualizar conteo de paises
  updateCountryCount(data.country || 'desconocido');
}

function recordQuiz(data) {
  var ss = getOrCreateSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEET_NAME_QUIZZES, ['timestamp', 'ip', 'pais', 'modulo', 'pregunta', 'tipo', 'correcto', 'tiempoTotal', 'matches']);
  
  sheet.appendRow([
    new Date(),
    data.ip || 'desconocido',
    data.country || 'desconocido',
    data.mod || '',
    data.q != null ? data.q : '',
    data.type || '',
    data.correct === true ? 1 : (data.correct === false ? 0 : ''),
    data.timeTotal || 0,
    data.matches != null ? data.matches : ''
  ]);
}

function updateCountryCount(country) {
  if (!country || country === 'desconocido' || country === 'No disponible' || country === 'Bloqueado por navegador' || country === 'Detectando...' || country === 'Local' || country === 'No identificado') {
    return;
  }
  
  var ss = getOrCreateSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEET_NAME_PAISES, ['pais', 'conteo']);
  
  var data = sheet.getDataRange().getValues();
  var found = false;
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === country) {
      sheet.getRange(i + 1, 2).setValue(data[i][1] + 1);
      found = true;
      break;
    }
  }
  
  if (!found) {
    sheet.appendRow([country, 1]);
  }
}

// ==========================================
// CALCULO DE METRICAS GLOBALES
// ==========================================
function getGlobalMetrics() {
  var ss = getOrCreateSpreadsheet();
  
  // 1. Promedio de aciertos global
  var quizSheet = getOrCreateSheet(ss, SHEET_NAME_QUIZZES, ['timestamp', 'ip', 'pais', 'modulo', 'pregunta', 'tipo', 'correcto', 'tiempoTotal', 'matches']);
  var quizData = quizSheet.getDataRange().getValues();
  
  var totalMC = 0, correctMC = 0;
  var totalDev = 0, correctDev = 0;
  var modStats = {mod1: {total: 0, correct: 0}, mod2: {total: 0, correct: 0}, mod3: {total: 0, correct: 0}, mod4: {total: 0, correct: 0}};
  
  for (var i = 1; i < quizData.length; i++) {
    var row = quizData[i];
    var mod = row[3];  // modulo
    var type = row[5]; // tipo
    var correct = row[6]; // correcto (1/0/empty)
    
    if (type === 'mc') {
      totalMC++;
      if (correct === 1) correctMC++;
    } else if (type === 'dev') {
      totalDev++;
      if (correct === 1) correctDev++;
    }
    
    if (mod && modStats[mod]) {
      modStats[mod].total++;
      if (correct === 1) modStats[mod].correct++;
    }
  }
  
  var totalAnswered = totalMC + totalDev;
  var avgScore = totalAnswered > 0 ? Math.round((correctMC + correctDev) / totalAnswered * 10 * 10) / 10 : null;
  
  // 2. Usuarios unicos (por IP)
  var visitSheet = getOrCreateSheet(ss, SHEET_NAME_VISITAS, ['timestamp', 'ip', 'pais', 'userAgent', 'tiempoTotal']);
  var visitData = visitSheet.getDataRange().getValues();
  var uniqueIPs = {};
  for (var j = 1; j < visitData.length; j++) {
    var ip = visitData[j][1];
    if (ip) uniqueIPs[ip] = true;
  }
  var uniqueUsers = Object.keys(uniqueIPs).length;
  
  // 3. Mejor y peor modulo
  var bestMod = null, bestRate = -1;
  var worstMod = null, worstRate = 2;
  
  for (var m in modStats) {
    if (modStats[m].total > 0) {
      var rate = modStats[m].correct / modStats[m].total;
      if (rate > bestRate) { bestRate = rate; bestMod = m; }
      if (rate < worstRate) { worstRate = rate; worstMod = m; }
    }
  }
  
  var modNames = {
    mod1: 'Test de Hipotesis',
    mod2: 'Regresion Lineal',
    mod3: 'Regresion Logistica',
    mod4: 'Series de Tiempo'
  };
  
  return {
    avgScore: avgScore,
    uniqueUsers: uniqueUsers,
    bestModule: bestMod ? {name: bestMod, rate: bestRate} : null,
    worstModule: worstMod ? {name: worstMod, rate: worstRate} : null,
    totals: {
      mc: totalMC,
      correctMC: correctMC,
      dev: totalDev,
      correctDev: correctDev,
      totalAnswered: totalAnswered
    }
  };
}

function getCountries() {
  var ss = getOrCreateSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEET_NAME_PAISES, ['pais', 'conteo']);
  var data = sheet.getDataRange().getValues();
  var countries = [];
  
  for (var i = 1; i < data.length; i++) {
    countries.push({name: data[i][0], count: data[i][1]});
  }
  
  return {
    total: countries.length,
    countries: countries
  };
}

// ==========================================
// UTILIDADES
// ==========================================
function getOrCreateSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  
  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (e) {
      // Si falla, crear nuevo
    }
  }
  
  var ss = SpreadsheetApp.create('Analytics - Analitica de Datos');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('white');
    }
  }
  return sheet;
}

function jsonResponse(data, statusCode) {
  statusCode = statusCode || 200;
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
    .setHttpResponseCode(statusCode);
}

// Configuracion de CORS para permitir acceso desde cualquier origen
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}
