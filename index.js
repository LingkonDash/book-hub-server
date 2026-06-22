const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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


    // server check
    app.get('/', (req, res) => {
      res.send('Book HUb server is running!')
    });


    // Books endpoint 1------------------------------------------
    // GET /books?page=1&limit=12&category=fiction&search=harry
    app.get('/books', async (req, res) => {

      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const category = req.query.category || '';
        const search = req.query.search || '';
        const sort = req.query.sort || 'latest';
        const skip = (page - 1) * limit;

        const filter = {};

        if (category) {
          filter.category = category;
        }

        if (search) {
          filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ];
        }

        // ── Sort logic 
        let sortQuery = {};

        if (sort === 'latest') {
          sortQuery = { createdAt: -1 };           // newest first
        } else if (sort === 'price-low') {
          sortQuery = { deliveryFee: 1 };          // lowest fee first
        } else if (sort === 'price-high') {
          sortQuery = { deliveryFee: -1 };         // highest fee first
        } else if (sort === 'available') {
          filter.status = 'published';             // only show published books
          sortQuery = { createdAt: -1 };           // among those, newest first
        }

        const total = await bookCollection.countDocuments(filter);
        const books = await bookCollection
          .find(filter)
          .sort(sortQuery)
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


    // ── Get single book detail ──
    // GET /books/:id
    app.get('/books/:id', async (req, res) => {
      try {
        const book = await bookCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!book) return res.status(404).json({ message: 'Book not found' });
        res.json(book);
      } catch (e) {
        res.status(500).json({ message: 'Failed to fetch book', error: e.message });
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
