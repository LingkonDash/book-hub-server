const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();

dotenv.config();
const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI

app.use(cors());
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    
    await client.connect();
    
    const db = client.db('book-hub');
    const bookCollection = db.collection('books');

    app.get('/books', async (req, res) => {
      const books = await bookCollection.find().toArray();

      res.json(books);
      
    })

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run();


app.get('/', (req, res) => {
  res.send('server is running fine!')
});

app.listen(port, () => {
  console.log('server is running on port ', port);
});
