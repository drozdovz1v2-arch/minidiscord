const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = 4000;
const JWT_SECRET = 'supersecretkey';

app.use(cors({ origin: '*' })); // разрешаем все origin
app.use(bodyParser.json());

mongoose.connect('mongodb://127.0.0.1:27017/mini_discord', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});

const User = mongoose.model('User', userSchema);

// Регистрация
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  console.log('Регистрация:', req.body);

  if (!username || !password) return res.status(400).json({ error: 'Введите имя и пароль' });

  const hash = await bcrypt.hash(password, 10);

  try {
    const user = new User({ username, password: hash });
    await user.save();
    res.json({ message: 'Пользователь создан' });
  } catch (err) {
    res.status(400).json({ error: 'Имя пользователя уже занято' });
  }
});

// Логин
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Логин:', req.body);

  if (!username || !password) return res.status(400).json({ error: 'Введите имя и пароль' });

  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return res.status(400).json({ error: 'Неверный пароль' });

  const token = jwt.sign({ id: user._id, username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ message: 'Успешно вошли', token });
});

app.listen(PORT, () => console.log(`Auth сервер запущен на http://localhost:${PORT}`));