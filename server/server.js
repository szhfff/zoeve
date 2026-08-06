const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { initDatabase } = require('./db/db');

const usersRouter = require('./routes/users');
const customersRouter = require('./routes/customers');
const clothRouter = require('./routes/cloth');
const recordsRouter = require('./routes/records');
const priceListsRouter = require('./routes/priceLists');
const rolesRouter = require('./routes/roles');
const washOrdersRouter = require('./routes/washOrders');
const reportsRouter = require('./routes/reports');
const settlementsRouter = require('./routes/settlements');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '../')));

app.use('/api/users', usersRouter);
app.use('/api/customers', customersRouter);
app.use('/api/cloth', clothRouter);
app.use('/api/records', recordsRouter);
app.use('/api/pricelists', priceListsRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/washorders', washOrdersRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settlements', settlementsRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../standalone.html'));
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Zoeve洗涤管理系统后端服务启动成功`);
    console.log(`访问地址: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});