# Pulse Chat

Real-time chat application with MongoDB persistence, message reactions, and one-time photos.

## Features
- Real-time messaging with Socket.IO
- MongoDB message persistence
- Message status ticks (sent/delivered/seen)
- Message editing (1-hour window)
- Message deletion
- Emoji reactions
- Image sharing
- One-time photos with screenshot protection
- Responsive mobile design

## Local Development

```bash
# Install MongoDB locally or use MongoDB Atlas
# Create .env file
echo "MONGODB_URI=mongodb://localhost:27017/pulsechat" > .env

# Install and run
npm install
npm start
```

Open http://localhost:3000

## Deployment

### Render (Free Tier)
1. Push code to GitHub
2. Create Render account at render.com
3. New Web Service → Connect GitHub repo
4. Environment Variables:
   - `MONGODB_URI` - Your MongoDB Atlas connection string
5. Deploy!

### Railway
1. Push to GitHub
2. Go to railway.app → New Project
3. Deploy from GitHub
4. Add MongoDB plugin or use external MongoDB Atlas
5. Set `MONGODB_URI` environment variable

### Heroku
```bash
heroku create
heroku addons:create mongolab:sandbox
git push heroku main
```

## Environment Variables
- `MONGODB_URI` - MongoDB connection string (default: local)
- `PORT` - Server port (default: 3000)