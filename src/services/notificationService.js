const OneSignal = require('onesignal-node');

// Initialize OneSignal client lazily
let client = null;

const getClient = () => {
    if (client) return client;
    
    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !apiKey) {
        console.warn('⚠️ OneSignal credentials not configured - notifications disabled');
        return null;
    }

    client = new OneSignal.Client(appId, apiKey);
    console.log('✅ OneSignal client initialized');
    return client;
};

/**
 * Send a push notification to all users
 */
const sendNotification = async ({ title, message, url, imageUrl, data = {} }) => {
    const oneSignalClient = getClient();
    if (!oneSignalClient) {
        console.log('📵 Notification skipped (OneSignal not configured):', title);
        return null;
    }

    try {
        const notification = {
            headings: { en: title },
            contents: { en: message },
            included_segments: ['All'],
            data: data
        };

        if (url) {
            notification.url = url;
        }

        if (imageUrl) {
            notification.big_picture = imageUrl;
            notification.chrome_web_image = imageUrl;
            notification.ios_attachments = { image: imageUrl };
        }

        const response = await oneSignalClient.createNotification(notification);
        console.log('✅ Notification sent:', title, '- Recipients:', response.body.recipients);
        return response.body;
    } catch (error) {
        console.error('❌ Failed to send notification:', error.message);
        return null;
    }
};

/**
 * Notification templates for automatic notifications
 */
const NotificationTemplates = {
    // New book published
    newBook: (book) => ({
        title: '📚 New Story Available!',
        message: `"${book.title}" by ${book.author} is now available to read!`,
        url: `/#/book/${book._id}`,
        imageUrl: book.files?.coverImage || book.coverImage || null,
        data: { type: 'new_book', bookId: book._id.toString() }
    }),

    // New playlist published
    newPlaylist: (playlist) => ({
        title: playlist.type === 'Song' ? '🎵 New Music Playlist!' : '🎧 New Audio Adventure!',
        message: `"${playlist.title}" is now available to listen!`,
        url: `/#/audio/playlist/${playlist._id}`,
        imageUrl: playlist.coverImage || null,
        data: { type: 'new_playlist', playlistId: playlist._id.toString(), playlistType: playlist.type }
    }),

    // New episode/song added to playlist
    newPlaylistItem: (playlist, item, itemType) => ({
        title: itemType === 'Song' ? '🎵 New Song Added!' : '🎧 New Episode Available!',
        message: `"${item.title}" has been added to "${playlist.title}"`,
        url: `/#/audio/playlist/${playlist._id}`,
        imageUrl: item.coverImage || playlist.coverImage || null,
        data: { 
            type: 'new_playlist_item', 
            playlistId: playlist._id.toString(), 
            itemTitle: item.title,
            itemType: itemType
        }
    }),

    // New lesson published
    newLesson: (lesson) => ({
        title: '⭐ New Lesson Ready!',
        message: `"${lesson.title}" is waiting for you. Let's learn together!`,
        url: `/#/lesson/${lesson._id}`,
        imageUrl: lesson.thumbnailUrl || null,
        data: { type: 'new_lesson', lessonId: lesson._id.toString() }
    })
};

/**
 * Send notification for new book
 */
const notifyNewBook = async (book) => {
    if (book.status !== 'published') return null;
    const template = NotificationTemplates.newBook(book);
    return sendNotification(template);
};

/**
 * Send notification for new playlist
 */
const notifyNewPlaylist = async (playlist) => {
    if (playlist.status !== 'published') return null;
    const template = NotificationTemplates.newPlaylist(playlist);
    return sendNotification(template);
};

/**
 * Send notification for new playlist item (episode/song)
 */
const notifyNewPlaylistItem = async (playlist, newItem) => {
    if (playlist.status !== 'published') return null;
    const itemType = playlist.type === 'Song' ? 'Song' : 'Episode';
    const template = NotificationTemplates.newPlaylistItem(playlist, newItem, itemType);
    return sendNotification(template);
};

/**
 * Send notification for new lesson
 */
const notifyNewLesson = async (lesson) => {
    if (!lesson.published) return null;
    const template = NotificationTemplates.newLesson(lesson);
    return sendNotification(template);
};

module.exports = {
    sendNotification,
    notifyNewBook,
    notifyNewPlaylist,
    notifyNewPlaylistItem,
    notifyNewLesson,
    NotificationTemplates
};

