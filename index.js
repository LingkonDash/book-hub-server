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

    app.get('/', (req, res) => {
      res.send('Book HUb server is running!')
    });

    // GET /books?page=1&limit=12&category=fiction&search=harry
    app.get('/books', async (req, res) => {
      console.log(req.query);
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const category = req.query.category || '';
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const filter = { }; // $ne: { status: 'pending' } // only show approved books

        if (category) {
          filter.category = category; // e.g. "fiction", "sci-fi-fantasy"
        }

        if (search) {
          // Search in both book name and description (case-insensitive)
          filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ];
        }

        const total = await bookCollection.countDocuments(filter);
        const books = await bookCollection
          .find(filter)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.json({
          books,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        });
      } catch (e) {
        res.status(500).json({ message: 'Failed to fetch books', error: e.message });
      }
    });

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run();


app.listen(port, () => {
  console.log('server is running on port ', port);
});
