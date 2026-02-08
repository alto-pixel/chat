// =====================================================
// NEXUS - Configuration et Utilitaires JavaScript
// À utiliser avec index.html pour des fonctionnalités avancées
// =====================================================

/**
 * Configuration Supabase Realtime avec Broadcast
 * Fonctionne SANS réplication - disponible immédiatement !
 */

// Setup Realtime pour les messages (avec Broadcast, pas Database Changes)
function setupRealtimeMessages(channelId, onNewMessage) {
    const channel = supabase
        .channel(`room:${channelId}`, {
            config: {
                broadcast: { self: false } // Ne pas recevoir ses propres messages
            }
        })
        .on('broadcast', { event: 'new-message' }, ({ payload }) => {
            onNewMessage(payload);
        })
        .subscribe();

    return channel; // Retourner pour pouvoir unsubscribe plus tard
}

// Fonction pour broadcaster un message
async function broadcastMessage(channelId, message) {
    const channel = supabase.channel(`room:${channelId}`);
    
    await channel.send({
        type: 'broadcast',
        event: 'new-message',
        payload: message
    });
}

// Exemple d'utilisation
/*
// Dans votre composant React
const channel = setupRealtimeMessages('channel-id', (newMessage) => {
    console.log('Nouveau message reçu:', newMessage);
    setMessages(prev => [...prev, newMessage]);
});

// Quand vous envoyez un message
const handleSend = async () => {
    const message = { id: Date.now(), text: 'Hello', author: 'User' };
    
    // Ajouter localement
    setMessages(prev => [...prev, message]);
    
    // Broadcaster aux autres
    await broadcastMessage('channel-id', message);
    
    // Optionnel : sauvegarder en DB
    await supabase.from('messages').insert(message);
};

// Cleanup
return () => supabase.removeChannel(channel);
*/

/**
 * Gestion des présences utilisateurs (Realtime Presence)
 * Fonctionne immédiatement, pas besoin de réplication !
 */
function setupPresence(userId, username) {
    const presenceChannel = supabase.channel('online-users', {
        config: {
            presence: {
                key: userId,
            },
        },
    });

    // Suivre les présences - fonctionne out-of-the-box
    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const presenceState = presenceChannel.presenceState();
            console.log('Utilisateurs en ligne:', presenceState);
            // Mettre à jour votre UI avec les utilisateurs en ligne
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            console.log('Utilisateur rejoint:', newPresences);
            // Afficher notification "X est en ligne"
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            console.log('Utilisateur parti:', leftPresences);
            // Afficher notification "X s'est déconnecté"
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                // Annoncer votre présence
                await presenceChannel.track({
                    user_id: userId,
                    username: username,
                    online_at: new Date().toISOString(),
                });
            }
        });

    return presenceChannel;
}

// Exemple d'utilisation dans React
/*
useEffect(() => {
    const presenceChannel = setupPresence(user.id, user.username);
    
    return () => {
        supabase.removeChannel(presenceChannel);
    };
}, [user]);
*/

/**
 * Système de notifications push
 */
async function sendNotification(userId, type, content) {
    const { data, error } = await supabase
        .from('notifications')
        .insert({
            user_id: userId,
            type: type,
            content: content,
            is_read: false
        });

    if (error) {
        console.error('Erreur notification:', error);
        return null;
    }

    return data;
}

/**
 * Gestion des demandes d'amitié
 */
async function sendFriendRequest(requesterId, addresseeId) {
    const { data, error } = await supabase
        .from('friendships')
        .insert({
            requester_id: requesterId,
            addressee_id: addresseeId,
            status: 'pending'
        });

    if (!error) {
        // Envoyer une notification
        await sendNotification(addresseeId, 'friend_request', {
            from: requesterId,
            message: 'Nouvelle demande d\'ami'
        });
    }

    return { data, error };
}

async function acceptFriendRequest(friendshipId) {
    const { data, error } = await supabase
        .rpc('accept_friendship', { friendship_id: friendshipId });

    return { data, error };
}

async function getFriends(userId) {
    const { data, error } = await supabase
        .from('friendships')
        .select(`
            *,
            requester:profiles!friendships_requester_id_fkey(id, username, avatar_url, status),
            addressee:profiles!friendships_addressee_id_fkey(id, username, avatar_url, status)
        `)
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq('status', 'accepted');

    return { data, error };
}

/**
 * Gestion des conversations privées
 */
async function getOrCreateConversation(userId1, userId2) {
    const { data, error } = await supabase
        .rpc('get_or_create_conversation', {
            user1_id: userId1,
            user2_id: userId2
        });

    return { data, error };
}

async function sendDirectMessage(conversationId, authorId, content) {
    const { data, error } = await supabase
        .from('direct_messages')
        .insert({
            conversation_id: conversationId,
            author_id: authorId,
            content: content
        });

    return { data, error };
}

/**
 * Upload de fichiers (avatars, pièces jointes)
 */
async function uploadAvatar(userId, file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;

    const { data, error } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true
        });

    if (error) {
        console.error('Erreur upload:', error);
        return null;
    }

    // Obtenir l'URL publique
    const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

    // Mettre à jour le profil
    await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

    return publicUrl;
}

async function uploadAttachment(messageId, file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${file.name}`;
    const filePath = `${messageId}/${fileName}`;

    const { data, error } = await supabase.storage
        .from('attachments')
        .upload(filePath, file);

    if (error) {
        console.error('Erreur upload:', error);
        return null;
    }

    const { data: { publicUrl } } = supabase.storage
        .from('attachments')
        .getPublicUrl(filePath);

    // Créer l'entrée dans la table attachments
    await supabase
        .from('attachments')
        .insert({
            message_id: messageId,
            file_name: file.name,
            file_url: publicUrl,
            file_type: file.type,
            file_size: file.size
        });

    return publicUrl;
}

/**
 * Gestion des serveurs
 */
async function createServer(ownerId, name, description = null) {
    // Générer un code d'invitation unique
    const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    const { data: server, error: serverError } = await supabase
        .from('servers')
        .insert({
            owner_id: ownerId,
            name: name,
            description: description,
            invite_code: inviteCode
        })
        .select()
        .single();

    if (serverError) {
        return { data: null, error: serverError };
    }

    // Ajouter le créateur comme membre
    await supabase
        .from('server_members')
        .insert({
            server_id: server.id,
            user_id: ownerId,
            role: 'owner'
        });

    // Créer une catégorie par défaut
    const { data: category } = await supabase
        .from('channel_categories')
        .insert({
            server_id: server.id,
            name: 'TEXTUEL',
            position: 0
        })
        .select()
        .single();

    // Créer un canal général
    await supabase
        .from('channels')
        .insert({
            server_id: server.id,
            category_id: category.id,
            name: 'général',
            description: 'Canal général de discussion',
            position: 0
        });

    return { data: server, error: null };
}

async function joinServer(userId, inviteCode) {
    // Trouver le serveur
    const { data: server, error: serverError } = await supabase
        .from('servers')
        .select('id')
        .eq('invite_code', inviteCode)
        .single();

    if (serverError || !server) {
        return { data: null, error: 'Code d\'invitation invalide' };
    }

    // Ajouter l'utilisateur comme membre
    const { data, error } = await supabase
        .from('server_members')
        .insert({
            server_id: server.id,
            user_id: userId,
            role: 'member'
        });

    return { data: server, error };
}

async function getUserServers(userId) {
    const { data, error } = await supabase
        .from('server_members')
        .select(`
            server:servers (
                id,
                name,
                description,
                icon_url,
                invite_code
            )
        `)
        .eq('user_id', userId);

    return { data, error };
}

/**
 * Gestion des canaux
 */
async function getServerChannels(serverId) {
    const { data, error } = await supabase
        .from('channels')
        .select(`
            *,
            category:channel_categories (
                id,
                name,
                position
            )
        `)
        .eq('server_id', serverId)
        .order('position');

    return { data, error };
}

async function createChannel(serverId, categoryId, name, description = null) {
    const { data, error } = await supabase
        .from('channels')
        .insert({
            server_id: serverId,
            category_id: categoryId,
            name: name,
            description: description
        })
        .select()
        .single();

    return { data, error };
}

/**
 * Gestion des messages
 */
async function getChannelMessages(channelId, limit = 50) {
    const { data, error } = await supabase
        .from('messages')
        .select(`
            *,
            author:profiles (
                id,
                username,
                display_name,
                avatar_url
            ),
            attachments (*),
            reactions (*)
        `)
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(limit);

    return { data, error };
}

async function sendMessage(channelId, authorId, content) {
    const { data, error } = await supabase
        .from('messages')
        .insert({
            channel_id: channelId,
            author_id: authorId,
            content: content
        })
        .select()
        .single();

    return { data, error };
}

async function editMessage(messageId, newContent) {
    const { data, error } = await supabase
        .from('messages')
        .update({
            content: newContent,
            edited_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .select()
        .single();

    return { data, error };
}

async function deleteMessage(messageId) {
    const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);

    return { error };
}

/**
 * Réactions aux messages
 */
async function addReaction(messageId, userId, emoji) {
    const { data, error } = await supabase
        .from('reactions')
        .insert({
            message_id: messageId,
            user_id: userId,
            emoji: emoji
        });

    return { data, error };
}

async function removeReaction(messageId, userId, emoji) {
    const { error } = await supabase
        .from('reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('emoji', emoji);

    return { error };
}

/**
 * Recherche
 */
async function searchMessages(serverId, query) {
    const { data, error } = await supabase
        .from('messages')
        .select(`
            *,
            channel:channels!inner (
                id,
                name,
                server_id
            ),
            author:profiles (
                id,
                username,
                avatar_url
            )
        `)
        .eq('channel.server_id', serverId)
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(20);

    return { data, error };
}

/**
 * Mise à jour du statut utilisateur
 */
async function updateUserStatus(userId, status, customStatus = null) {
    const { data, error } = await supabase
        .from('profiles')
        .update({
            status: status,
            custom_status: customStatus
        })
        .eq('id', userId);

    return { data, error };
}

/**
 * Gestion des permissions
 */
async function checkPermission(userId, serverId, permission) {
    // Récupérer le rôle de l'utilisateur
    const { data: member, error } = await supabase
        .from('server_members')
        .select('role')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .single();

    if (error) return false;

    // Vérifier si le rôle a cette permission
    const { data: rolePerms } = await supabase
        .from('role_permissions')
        .select('*')
        .eq('server_id', serverId)
        .eq('role_name', member.role)
        .eq('permission', permission);

    return rolePerms && rolePerms.length > 0;
}

/**
 * Utilitaires de formatage
 */
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // Aujourd'hui
    if (diff < 86400000) {
        return date.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    // Hier
    if (diff < 172800000) {
        return 'Hier ' + date.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    // Date complète
    return date.toLocaleDateString('fr-FR', { 
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function generateAvatarColor(username) {
    // Générer une couleur cohérente basée sur le username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Validation
 */
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateUsername(username) {
    // 3-20 caractères, alphanumériques et underscores
    const re = /^[a-zA-Z0-9_]{3,20}$/;
    return re.test(username);
}

function validatePassword(password) {
    // Min 6 caractères
    return password.length >= 6;
}

/**
 * Gestion des erreurs
 */
function handleSupabaseError(error) {
    console.error('Erreur Supabase:', error);
    
    const errorMessages = {
        '23505': 'Cet élément existe déjà',
        '23503': 'Élément référencé introuvable',
        '42501': 'Permission refusée',
        'PGRST116': 'Aucun résultat trouvé'
    };
    
    return errorMessages[error.code] || error.message || 'Une erreur est survenue';
}

/**
 * Export des fonctions
 * (Si vous utilisez des modules ES6)
 */
// export {
//     setupRealtimeMessages,
//     setupPresence,
//     sendNotification,
//     sendFriendRequest,
//     acceptFriendRequest,
//     getFriends,
//     // ... toutes les autres fonctions
// };

// =====================================================
// Fin des utilitaires
// =====================================================
