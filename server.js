const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.API_BASE_URL; // El punto de conexión de la API de base de datos

app.use(bodyParser.json());

// Función para obtener datos del hotel desde su API
async function getHotelData() {
  try {
    const response = await axios.get(`${API_BASE_URL}/hotel`);
    return response.data;
  } catch (error) {
    console.error('Error fetching hotel data:', error);
    throw error;
  }
}

// Función para actualizar la disponibilidad de habitaciones
async function updateRoomAvailability(roomId, dates, isAvailable) {
  try {
    const response = await axios.put(`${API_BASE_URL}/room/${roomId}/availability`, {
      dates,
      isAvailable
    });
    return response.data;
  } catch (error) {
    console.error('Error actualizando disponibilidad:', error);
    throw error;
  }
}

// Función para sincronizar con OTA
async function syncWithOTA() {
  try {
    const hotelData = await getHotelData();
    
    // Preparación de datos para OTA
    const otaData = {
      hotelId: hotelData.id,
      rooms: hotelData.rooms.map(room => ({
        roomType: room.roomType,
        price: room.price,
        availability: room.availability
      }))
    };

    // Enviar datos a la API OTA
    const response = await axios.post('https://ota-api-endpoint.com/update', otaData, {
      headers: {
        'Authorization': `Bearer ${process.env.OTA_API_KEY}`
      }
    });

    console.log('Synced with OTA:', response.data);
  } catch (error) {
    console.error('Error syncing with OTA:', error);
  }
}

// Programar sincronización OTA
cron.schedule('0 * * * *', () => {
  console.log('Running OTA sync');
  syncWithOTA();
});

// Endpoints
app.get('/api/hotel-data', async (req, res) => {
  try {
    const hotelData = await getHotelData();
    res.json(hotelData);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener datos del hotel ' });
  }
});

app.get('/propiedades/:id/disponibilidad', async (req, res) => {
  const { id } = req.params;
  try {
    const hotelData = await getHotelData();
    const room = hotelData.rooms.find(r => r.id === id);
    if (!room) {
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }
    res.json(room.availability);
  } catch (error) {
    console.error('Error al obtener disponibilidad de la habitación:', error);
    res.status(500).json({ error: 'Error al obtener disponibilidad de la habitación' });
  }
});
app.get('/propiedades/:id/disponibilidad', async (req, res) => {
    const { id } = req.params;
    try {
      const hotelData = await getHotelData();
      const room = hotelData.rooms.find(r => r.id === id);
      if (!room) {
        return res.status(404).json({ error: 'Habitación no encontrada' });
      }
      res.json(room.availability);
    } catch (error) {
      console.error('Error al obtener disponibilidad de la habitación:', error);
      res.status(500).json({ error: 'Error al obtener disponibilidad de la habitación' });
    }
  });
  

app.get('/buscar', async (req, res) => {
  const { fechaInicio, fechaFin, tipo, ubicacion, maxPrecio, minCalificacion } = req.query;
  try {
    const hotelData = await getHotelData();
    const availableRooms = hotelData.rooms.filter(room => {
      const isAvailable = room.availability.every(date => 
        (date.date >= fechaInicio && date.date <= fechaFin) ? date.available : true
      );
      const meetsType = !tipo || room.roomType === tipo;
      const meetsPrice = !maxPrecio || room.price <= maxPrecio;
      // Suponiendo que el hotel tiene una propiedad de calificación
      const meetsRating = !minCalificacion || hotelData.rating >= minCalificacion;

      return isAvailable && meetsType && meetsPrice && meetsRating;
    });

    res.status(200).json(availableRooms);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar propiedades' });
  }
});

app.post('/reservas', async (req, res) => {
  const { usuarioId, propiedadId, fechaInicio, fechaFin, roomType } = req.body;

  if (!usuarioId || !propiedadId || !fechaInicio || !fechaFin || !roomType) {
    return res.status(400).json({ error: 'Faltan datos de reserva obligatorios' });
  }

  try {
    const hotelData = await getHotelData();
    const room = hotelData.rooms.find(r => r.roomType === roomType);
    
    if (!room) {
      return res.status(404).json({ error: 'Tipo de habitación no encontrada' });
    }

    // Disponibilidad de actualizaciones
    const startDate = new Date(fechaInicio);
    const endDate = new Date(fechaFin);
    const datesToUpdate = [];
    for (let d = startDate; d <= endDate; d.setDate(d.getDate() + 1)) {
      datesToUpdate.push(d.toISOString().split('T')[0]);
    }

    await updateRoomAvailability(room.id, datesToUpdate, false);

    // Crear reserva (es posible que desee agregar un punto de conexión para esto en su API)
    const reservationData = { usuarioId, propiedadId, fechaInicio, fechaFin, roomType };
    const reservationResponse = await axios.post(`${API_BASE_URL}/reservations`, reservationData);

    // Activar la sincronización OTA
    await syncWithOTA();

    res.status(201).json({ message: 'Tu reserva ha sido creada!', reservation: reservationResponse.data });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear la reserva' });
  }
});

app.get('/reservas', async (req, res) => {
  try {
    const reservationsResponse = await axios.get(`${API_BASE_URL}/reservations`);
    res.status(200).json(reservationsResponse.data);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reservas' });
  }
});

app.get('/usuarios/:usuarioId/reservas', async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const reservationsResponse = await axios.get(`${API_BASE_URL}/reservations?usuarioId=${usuarioId}`);
    res.status(200).json(reservationsResponse.data);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reservas de usuario' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

/*
GET /propiedades: Obtiene la lista de propiedades.
GET /propiedades/
/disponibilidad: Verifica la disponibilidad de una propiedad.
POST /reservas: Crea una nueva reserva.
GET /reservas: Obtiene todas las reservas.
GET /usuarios/
/reservas: Obtiene las reservas de un usuario específico
*/