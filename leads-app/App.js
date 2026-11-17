import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    FlatList,
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions
} from 'react-native';

import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { io } from 'socket.io-client';

const API_URL = 'https://shindig-recipient-gratuity.ngrok-free.dev';

const HEADERS = {
    'ngrok-skip-browser-warning': '1'
};

const COLORS = {
    background: '#f4f6fb',
    card: '#ffffff',
    text: '#0f172a',
    muted: '#64748b',
    border: '#e8ecf4',
    primary: '#5b5bf0',
    secondary: '#8b5cf6',
    green: '#16a34a',
    red: '#dc2626'
};

const AVATAR_COLORS = [
    '#5b5bf0',
    '#ec4899',
    '#f59e0b',
    '#10b981',
    '#0ea5e9',
    '#8b5cf6'
];

// Get the lead's name
function getLeadName(lead) {
    return lead.fields.full_name ||
        lead.fields.first_name ||
        'Unknown';
}

// Assign a consistent color to each lead
function getAvatarColor(name = '') {
    const total = [...name].reduce((sum, character) => {
        return sum + character.charCodeAt(0);
    }, 0);

    return AVATAR_COLORS[total % AVATAR_COLORS.length];
}

// Generate initials for the lead avatar
function getInitials(name) {
    const words = name.split(' ').filter(Boolean);

    return words
        .slice(0, 2)
        .map(word => word[0].toUpperCase())
        .join('') || '?';
}

// Format the lead creation time
function getTimeAgo(date) {
    const seconds = Math.max(
        0,
        (Date.now() - new Date(date).getTime()) / 1000
    );

    if (seconds < 60) {
        return 'Just now';
    }

    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)} min ago`;
    }

    if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)} h ago`;
    }

    return new Date(date).toLocaleDateString();
}

// Check whether a lead was created today
function isToday(date) {
    return new Date(date).toDateString() === new Date().toDateString();
}


// Online / Offline indicator
function StatusPill({ connected }) {
    const pulseAnimation = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!connected) {
            return;
        }

        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnimation, {
                    toValue: 2,
                    duration: 900,
                    useNativeDriver: true
                }),
                Animated.timing(pulseAnimation, {
                    toValue: 1,
                    duration: 900,
                    useNativeDriver: true
                })
            ])
        );

        animation.start();

        return () => animation.stop();
    }, [connected, pulseAnimation]);

    const statusColor = connected ? '#4ade80' : '#f87171';

    return (
        <View style={styles.statusPill}>
            <View style={styles.statusDotContainer}>
                {connected && (
                    <Animated.View
                        style={[
                            styles.statusPulse,
                            {
                                backgroundColor: statusColor,
                                transform: [{ scale: pulseAnimation }]
                            }
                        ]}
                    />
                )}

                <View
                    style={[
                        styles.statusDot,
                        { backgroundColor: statusColor }
                    ]}
                />
            </View>

            <Text style={styles.statusText}>
                {connected ? 'Live' : 'Offline'}
            </Text>
        </View>
    );
}


// Notification displayed when a new lead arrives
function Toast({ lead }) {
    const translateY = useRef(new Animated.Value(-120)).current;

    useEffect(() => {
        if (!lead) {
            return;
        }

        Animated.sequence([
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true
            }),
            Animated.delay(3000),
            Animated.timing(translateY, {
                toValue: -120,
                duration: 250,
                useNativeDriver: true
            })
        ]).start();
    }, [lead, translateY]);

    if (!lead) {
        return null;
    }

    return (
        <Animated.View
            style={[
                styles.toast,
                { transform: [{ translateY }] }
            ]}
        >
            <View style={styles.toastIcon}>
                <Ionicons name="flash" size={18} color="#fff" />
            </View>

            <View style={{ flex: 1 }}>
                <Text style={styles.toastTitle}>
                    New lead received
                </Text>

                <Text style={styles.toastSubtitle}>
                    {getLeadName(lead)}
                </Text>
            </View>
        </Animated.View>
    );
}


// Dashboard statistics card
function StatCard({ icon, label, value, color }) {
    return (
        <View style={styles.statCard}>
            <View
                style={[
                    styles.statIcon,
                    { backgroundColor: color + '1f' }
                ]}
            >
                <Ionicons name={icon} size={18} color={color} />
            </View>

            <Text style={styles.statValue} numberOfLines={1}>
                {value}
            </Text>

            <Text style={styles.statLabel}>
                {label}
            </Text>
        </View>
    );
}


// Lead contact information row
function InfoRow({ icon, text }) {
    return (
        <View style={styles.infoRow}>
            <Ionicons name={icon} size={14} color={COLORS.muted} />

            <Text style={styles.infoText} numberOfLines={1}>
                {text}
            </Text>
        </View>
    );
}


// Individual lead card
function LeadCard({ lead, isNew }) {
    const name = getLeadName(lead);
    const email = lead.fields.email;
    const phone = lead.fields.phone_number;

    const avatarColor = getAvatarColor(name);

    const highlightAnimation = useRef(
        new Animated.Value(isNew ? 1 : 0)
    ).current;

    const slideAnimation = useRef(
        new Animated.Value(isNew ? -24 : 0)
    ).current;

    useEffect(() => {
        if (!isNew) {
            return;
        }

        Animated.parallel([
            Animated.spring(slideAnimation, {
                toValue: 0,
                useNativeDriver: false
            }),

            Animated.timing(highlightAnimation, {
                toValue: 0,
                duration: 4500,
                useNativeDriver: false
            })
        ]).start();
    }, []);

    const backgroundColor = highlightAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: ['#ffffff', '#eef2ff']
    });

    const borderColor = highlightAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [COLORS.border, COLORS.primary]
    });

    return (
        <Animated.View
            style={[
                styles.leadCard,
                {
                    backgroundColor,
                    borderColor,
                    transform: [{ translateY: slideAnimation }]
                }
            ]}
        >
            <View
                style={[
                    styles.cardAccent,
                    { backgroundColor: avatarColor }
                ]}
            />

            <View style={styles.cardContent}>

                <View style={styles.cardHeader}>
                    <View
                        style={[
                            styles.avatar,
                            { backgroundColor: avatarColor }
                        ]}
                    >
                        <Text style={styles.avatarText}>
                            {getInitials(name)}
                        </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                        <View style={styles.nameRow}>
                            <Text style={styles.leadName} numberOfLines={1}>
                                {name}
                            </Text>

                            {isNew && (
                                <View style={styles.newBadge}>
                                    <Text style={styles.newBadgeText}>
                                        NEW
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.timeRow}>
                            <Ionicons
                                name="time-outline"
                                size={12}
                                color={COLORS.muted}
                            />

                            <Text style={styles.timeText}>
                                {getTimeAgo(lead.createdTime)}
                            </Text>
                        </View>
                    </View>
                </View>

                <View style={styles.contactBox}>
                    <InfoRow
                        icon="mail-outline"
                        text={email || 'No email provided'}
                    />

                    <InfoRow
                        icon="call-outline"
                        text={phone || 'No phone provided'}
                    />
                </View>

                <View style={styles.actionButtons}>
                    <Pressable
                        disabled={!phone}
                        onPress={() => Linking.openURL(`tel:${phone}`)}
                        style={({ pressed }) => [
                            styles.button,
                            styles.callButton,
                            !phone && styles.disabledButton,
                            pressed && styles.pressedButton
                        ]}
                    >
                        <Ionicons name="call" size={15} color="#fff" />

                        <Text style={styles.callButtonText}>
                            Call
                        </Text>
                    </Pressable>

                    <Pressable
                        disabled={!email}
                        onPress={() => Linking.openURL(`mailto:${email}`)}
                        style={({ pressed }) => [
                            styles.button,
                            styles.emailButton,
                            !email && styles.disabledButton,
                            pressed && styles.pressedButton
                        ]}
                    >
                        <Ionicons
                            name="mail"
                            size={15}
                            color={COLORS.primary}
                        />

                        <Text style={styles.emailButtonText}>
                            Email
                        </Text>
                    </Pressable>
                </View>

            </View>
        </Animated.View>
    );
}


// Main application screen
function Main() {
    const [leads, setLeads] = useState([]);
    const [connected, setConnected] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [newLeadIds, setNewLeadIds] = useState(new Set());
    const [toastLead, setToastLead] = useState(null);
    const [searchText, setSearchText] = useState('');

    const { width, height } = useWindowDimensions();

    const isWideScreen = width >= 700;
    const isSmallScreen = width < 360;


    // Fetch leads from the backend
    const loadLeads = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/leads`, {
                headers: HEADERS
            });

            if (!response.ok) {
                throw new Error('Unable to load leads');
            }

            const data = await response.json();

            setLeads(data);

        } catch (error) {
            console.warn('Failed to load leads:', error.message);
        }
    }, []);


    // Connect to Socket.IO and listen for new leads
    useEffect(() => {
        loadLeads();

        const socket = io(API_URL, {
            transports: ['polling', 'websocket'],
            extraHeaders: HEADERS
        });

        socket.on('connect', () => {
            setConnected(true);
        });

        socket.on('disconnect', () => {
            setConnected(false);
        });

        socket.on('connect_error', (error) => {
            console.warn('Socket connection failed:', error.message);
        });

        socket.on('new_lead', (lead) => {
            setNewLeadIds(previousIds => {
                const updatedIds = new Set(previousIds);
                updatedIds.add(lead.id);

                return updatedIds;
            });

            setToastLead({ ...lead });

            setLeads(previousLeads => {
                const alreadyExists = previousLeads.some(
                    existingLead => existingLead.id === lead.id
                );

                if (alreadyExists) {
                    return previousLeads;
                }

                return [lead, ...previousLeads];
            });
        });

        socket.on('reset', () => {
            setLeads([]);
            setNewLeadIds(new Set());
            setToastLead(null);
        });

        return () => {
            socket.disconnect();
        };

    }, [loadLeads]);


    // Filter leads based on the search input
    const filteredLeads = useMemo(() => {
        const search = searchText.trim().toLowerCase();

        if (!search) {
            return leads;
        }

        return leads.filter(lead => {
            const searchData = [
                getLeadName(lead),
                lead.fields.email,
                lead.fields.phone_number
            ].join(' ').toLowerCase();

            return searchData.includes(search);
        });

    }, [leads, searchText]);


    // Calculate today's leads
    const todayCount = leads.filter(lead => {
        return isToday(lead.createdTime);
    }).length;


    // Dashboard header
    const Header = (
        <>
            <LinearGradient
                colors={[COLORS.primary, COLORS.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.hero}
            >
                <View style={styles.heroTop}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.heroSubtitle}>
                            Meta Lead Ads
                        </Text>

                        <Text style={styles.heroTitle}>
                            Lead Inbox
                        </Text>
                    </View>

                    <StatusPill connected={connected} />
                </View>
            </LinearGradient>


            {/* Dashboard statistics */}
            <View
                style={[
                    styles.statsContainer,
                    isSmallScreen && { flexWrap: 'wrap' }
                ]}
            >
                <StatCard
                    icon="people"
                    label="Total leads"
                    value={leads.length}
                    color={COLORS.primary}
                />

                <StatCard
                    icon="today"
                    label="Today"
                    value={todayCount}
                    color="#f59e0b"
                />

                <StatCard
                    icon="flash"
                    label="Latest"
                    value={
                        leads[0]
                            ? getTimeAgo(leads[0].createdTime)
                            : '—'
                    }
                    color="#10b981"
                />
            </View>


            {/* Lead search */}
            <View style={styles.searchBox}>
                <Ionicons
                    name="search"
                    size={18}
                    color={COLORS.muted}
                />

                <TextInput
                    style={styles.searchInput}
                    placeholder="Search by name, email or phone"
                    placeholderTextColor="#94a3b8"
                    value={searchText}
                    onChangeText={setSearchText}
                />

                {!!searchText && (
                    <Pressable onPress={() => setSearchText('')}>
                        <Ionicons
                            name="close-circle"
                            size={18}
                            color="#94a3b8"
                        />
                    </Pressable>
                )}
            </View>
        </>
    );


    // Main screen
    return (
        <SafeAreaView
            style={styles.safeArea}
            edges={['top', 'left', 'right']}
        >
            <StatusBar
                barStyle="light-content"
                backgroundColor={COLORS.primary}
            />

            <View
                style={[
                    styles.page,
                    isWideScreen && { maxWidth: 640 },
                    Platform.OS === 'web' && { height }
                ]}
            >
                <FlatList
                    data={filteredLeads}
                    keyExtractor={lead => String(lead.id)}
                    ListHeaderComponent={Header}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 80 }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"

                    refreshControl={
                        <RefreshControl
                            tintColor={COLORS.primary}
                            refreshing={refreshing}
                            onRefresh={async () => {
                                setRefreshing(true);

                                await loadLeads();

                                setRefreshing(false);
                            }}
                        />
                    }

                    renderItem={({ item }) => (
                        <LeadCard
                            lead={item}
                            isNew={newLeadIds.has(item.id)}
                        />
                    )}

                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIcon}>
                                <Ionicons
                                    name={
                                        searchText
                                            ? 'search'
                                            : 'mail-open-outline'
                                    }
                                    size={34}
                                    color={COLORS.primary}
                                />
                            </View>

                            <Text style={styles.emptyTitle}>
                                {searchText
                                    ? 'No matching leads'
                                    : 'Waiting for leads'}
                            </Text>

                            <Text style={styles.emptySubtitle}>
                                {searchText
                                    ? 'Try a different search term.'
                                    : 'Submit a test lead in Meta’s Lead Ads Testing Tool. It will show up here instantly.'}
                            </Text>
                        </View>
                    }
                />

                <Toast lead={toastLead} />
            </View>
        </SafeAreaView>
    );
}


// Application entry point
export default function App() {
    return (
        <SafeAreaProvider>
            <Main />
        </SafeAreaProvider>
    );
}


// Platform-specific shadow styles
const shadow = Platform.select({
    web: {
        boxShadow: '0 4px 16px rgba(15,23,42,0.07)'
    },

    default: {
        shadowColor: '#0f172a',
        shadowOpacity: 0.07,
        shadowRadius: 12,
        shadowOffset: {
            width: 0,
            height: 4
        },
        elevation: 3
    }
});


// Application styles
const styles = StyleSheet.create({

    safeArea: {
        flex: 1,
        backgroundColor: COLORS.background
    },

    page: {
        flex: 1,
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
        backgroundColor: COLORS.background
    },


    // Header
    hero: {
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 64,
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28
    },

    heroTop: {
        flexDirection: 'row',
        alignItems: 'center'
    },

    heroSubtitle: {
        color: '#c7d2fe',
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.5
    },

    heroTitle: {
        color: '#fff',
        fontSize: 32,
        fontWeight: '800',
        marginTop: 2
    },


    // Connection status
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.18)',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20
    },

    statusDotContainer: {
        width: 14,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 6
    },

    statusPulse: {
        position: 'absolute',
        width: 8,
        height: 8,
        borderRadius: 4,
        opacity: 0.4
    },

    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4
    },

    statusText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 13
    },


    // Statistics
    statsContainer: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 16,
        marginTop: -40,
        marginBottom: 14
    },

    statCard: {
        flex: 1,
        minWidth: 96,
        backgroundColor: COLORS.card,
        borderRadius: 18,
        padding: 12,
        alignItems: 'center',
        ...shadow
    },

    statIcon: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8
    },

    statValue: {
        color: COLORS.text,
        fontSize: 18,
        fontWeight: '800'
    },

    statLabel: {
        color: COLORS.muted,
        fontSize: 11.5,
        marginTop: 2
    },


    // Search
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.card,
        marginHorizontal: 16,
        marginBottom: 14,
        paddingHorizontal: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: COLORS.border
    },

    searchInput: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 10,
        fontSize: 15,
        color: COLORS.text,
        ...Platform.select({
            web: { outlineStyle: 'none' },
            default: {}
        })
    },


    // Lead card
    leadCard: {
        flexDirection: 'row',
        marginHorizontal: 16,
        marginBottom: 14,
        borderRadius: 18,
        borderWidth: 1,
        overflow: 'hidden',
        ...shadow
    },

    cardAccent: {
        width: 5
    },

    cardContent: {
        flex: 1,
        padding: 14
    },

    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center'
    },

    avatar: {
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12
    },

    avatarText: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '800'
    },

    nameRow: {
        flexDirection: 'row',
        alignItems: 'center'
    },

    leadName: {
        color: COLORS.text,
        fontSize: 17,
        fontWeight: '700',
        flexShrink: 1
    },

    newBadge: {
        backgroundColor: COLORS.primary,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 2,
        marginLeft: 8
    },

    newBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.5
    },

    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 3,
        gap: 4
    },

    timeText: {
        color: COLORS.muted,
        fontSize: 12
    },


    // Contact information
    contactBox: {
        backgroundColor: '#f8fafc',
        borderRadius: 12,
        padding: 10,
        marginTop: 12,
        gap: 6
    },

    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },

    infoText: {
        color: '#334155',
        fontSize: 13.5,
        flex: 1
    },


    // Call and email buttons
    actionButtons: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12
    },

    button: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 12
    },

    callButton: {
        backgroundColor: COLORS.primary
    },

    emailButton: {
        backgroundColor: '#eef2ff'
    },

    callButtonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14
    },

    emailButtonText: {
        color: COLORS.primary,
        fontWeight: '700',
        fontSize: 14
    },

    disabledButton: {
        opacity: 0.35
    },

    pressedButton: {
        opacity: 0.8,
        transform: [{ scale: 0.98 }]
    },


    // New lead notification
    toast: {
        position: 'absolute',
        top: 10,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0f172a',
        borderRadius: 16,
        padding: 12,
        zIndex: 20,
        ...shadow
    },

    toastIcon: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12
    },

    toastTitle: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14
    },

    toastSubtitle: {
        color: '#cbd5e1',
        fontSize: 13,
        marginTop: 1
    },


    // Empty state
    emptyState: {
        alignItems: 'center',
        marginTop: 40,
        paddingHorizontal: 36
    },

    emptyIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#eef2ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16
    },

    emptyTitle: {
        color: COLORS.text,
        fontSize: 18,
        fontWeight: '700'
    },

    emptySubtitle: {
        color: COLORS.muted,
        fontSize: 14,
        textAlign: 'center',
        marginTop: 6,
        lineHeight: 20
    }

});
