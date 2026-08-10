// src/screens/CustomerScreen.js
import React, {
  useState, useCallback, useEffect,
} from 'react';
import {
  View, ScrollView, SafeAreaView, StatusBar, Image, Alert, StyleSheet,
} from 'react-native';
import {
  Text, Button, Card, TextInput, Surface, ActivityIndicator,
  Portal, Modal, Avatar, useTheme, BottomNavigation,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';

import { toMoney } from '../utils/format';
import { identifyDishFromImage } from '../services/geminiService';
import { fetchFoodDeals, reserveFoodDeal, publishFoodDeal, getImpactStats } from '../services/appDataService';
import { useAuth } from '../context/AuthContext';

const IMAGE_QUALITY = 0.3;

function FoodTab({ theme }) {
  const { user } = useAuth();
  const [foodDeals, setFoodDeals] = useState([]);
  const [isLoadingDeals, setIsLoadingDeals] = useState(true);
  const [mealsSaved, setMealsSaved] = useState(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [imageUri, setImageUri] = useState(null);
  const [dishName, setDishName] = useState('');
  const [stallName, setStallName] = useState('My Hawker Stall');
  const [discountPrice, setDiscountPrice] = useState('3.00');
  const [originalPrice, setOriginalPrice] = useState('6.00');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [aiWarning, setAiWarning] = useState('');

  const loadDeals = useCallback(async () => {
    try {
      setFoodDeals(await fetchFoodDeals());
    } catch (err) {
      Alert.alert('Could not load food deals', err.message || 'Please try again.');
    } finally {
      setIsLoadingDeals(false);
    }
  }, []);

  const loadImpact = useCallback(async () => {
    try {
      const stats = await getImpactStats();
      setMealsSaved(stats.mealsSaved);
    } catch (err) {
      setMealsSaved(0);
    }
  }, []);

  useEffect(() => { loadDeals(); loadImpact(); }, [loadDeals, loadImpact]);

  const runAiAnalysis = useCallback(async (base64) => {
    setIsAnalyzing(true);
    setAiWarning('');
    setDishName('');
    try {
      const identified = await identifyDishFromImage(base64);
      if (identified) {
        setDishName(identified);
        setAiWarning(`✅ Identified: ${identified}`);
      } else {
        setAiWarning('❌ Dish not recognized. Please enter the dish name manually.');
      }
    } catch (err) {
      setAiWarning(err.message === 'MISSING_KEY'
        ? '⚠️ No Gemini API key configured. Enter the dish name manually for now.'
        : `⚠️ ${err.message || 'AI analysis failed.'} Please enter the dish name manually.`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const takeFoodPhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Camera access is required to snap a meal photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true, base64: true, quality: IMAGE_QUALITY,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setImageUri(asset.uri);
      setDishName('');
      setStallName('My Hawker Stall');
      setDiscountPrice('3.00');
      setOriginalPrice('6.00');
      setModalVisible(true);
      runAiAnalysis(asset.base64);
    } catch (err) {
      Alert.alert('Camera error', err.message || 'Could not open the camera. Please try again.');
    }
  }, [runAiAnalysis]);

  const handlePublishDeal = useCallback(async () => {
    const trimmedDish = dishName.trim();
    if (!trimmedDish) {
      Alert.alert('Missing dish name', 'Please enter a dish name before publishing.');
      return;
    }
    setIsPublishing(true);
    try {
      const published = await publishFoodDeal({
        stall: stallName.trim(),
        item: trimmedDish,
        price: toMoney(discountPrice),
        originalPrice: toMoney(originalPrice),
        image: imageUri,
        merchantEmail: user.email,
      });
      setFoodDeals((prev) => [published, ...prev]);
      setModalVisible(false);
      setImageUri(null);
      Alert.alert('Published! 🎉', 'Your surplus meal is now live on KampongCycle!');
    } catch (err) {
      Alert.alert('Could not publish', err.message || 'Please try again.');
    } finally {
      setIsPublishing(false);
    }
  }, [dishName, stallName, discountPrice, originalPrice, imageUri, user.email]);

  const handleReserveDeal = useCallback(async (dealId) => {
    const deal = foodDeals.find((d) => d.id === dealId);
    try {
      await reserveFoodDeal(dealId, deal);
      setFoodDeals((prev) => prev.filter((d) => d.id !== dealId));
      setMealsSaved((prev) => (prev === null ? 1 : prev + 1));
      if (deal) Alert.alert('Reserved! 🎉', `You reserved ${deal.item}.`);
    } catch (err) {
      Alert.alert('Could not reserve', err.message || 'Please try again.');
    }
  }, [foodDeals]);

  const closeModal = useCallback(() => {
    setModalVisible(false); setImageUri(null); setAiWarning('');
  }, []);

  return (
    <ScrollView style={styles.tabContent}>
      <Surface style={[styles.impactBanner, { backgroundColor: theme.colors.primary }]} elevation={1}>
        <Text variant="displaySmall" style={styles.impactCount}>
          {mealsSaved === null ? '—' : mealsSaved}
        </Text>
        <Text variant="bodySmall" style={styles.impactLabel}>meals saved from going to waste 🌍</Text>
      </Surface>

      <Card style={styles.aiCard} mode="contained">
        <Card.Content style={{ alignItems: 'center' }}>
          <Text variant="titleMedium" style={{ color: theme.colors.error, fontWeight: 'bold' }}>
            List Surplus Food 📸
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
            Snap a meal photo to auto-verify and list surplus deals
          </Text>
          <Button mode="contained" buttonColor={theme.colors.error} onPress={takeFoodPhoto} icon="camera">
            Snap & List
          </Button>
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        Active Surplus Deals 🍲 ({foodDeals.length})
      </Text>

      {isLoadingDeals ? (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      ) : foodDeals.length === 0 ? (
        <Text style={styles.emptyText}>No deals listed yet. Snap a meal to add one!</Text>
      ) : (
        foodDeals.map((deal) => (
          <Card key={deal.id} style={styles.dealCard} mode="elevated">
            <Card.Content style={styles.dealCardContent}>
              {deal.image && <Avatar.Image size={48} source={{ uri: deal.image }} style={{ marginRight: 12 }} />}
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{deal.item}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{deal.stall}</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.secondary, fontWeight: 'bold' }}>
                  {deal.price} <Text style={{ textDecorationLine: 'line-through', color: theme.colors.outline, fontSize: 12 }}>{deal.originalPrice}</Text>
                </Text>
              </View>
              <Button mode="contained" buttonColor={theme.colors.secondary} onPress={() => handleReserveDeal(deal.id)} compact>
                Reserve
              </Button>
            </Card.Content>
          </Card>
        ))
      )}

      <Portal>
        <Modal visible={modalVisible} onDismiss={closeModal} contentContainerStyle={styles.modalContent}>
          <Text variant="titleLarge" style={{ textAlign: 'center', marginBottom: 12 }}>AI Vision Scan</Text>
          {imageUri && <Image source={{ uri: imageUri }} style={styles.modalImage} />}

          {isAnalyzing ? (
            <View style={{ alignItems: 'center', marginVertical: 20 }}>
              <ActivityIndicator size="large" />
              <Text style={{ marginTop: 8, color: theme.colors.primary }}>Analyzing dish features with Vision AI...</Text>
            </View>
          ) : (
            <View>
              {!!aiWarning && (
                <Text style={{ color: theme.colors.error, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>
                  {aiWarning}
                </Text>
              )}
              <TextInput label="Dish Name" value={dishName} onChangeText={setDishName} mode="outlined" style={styles.input} />
              <TextInput label="Stall Name" value={stallName} onChangeText={setStallName} mode="outlined" style={styles.input} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <TextInput
                  label="Discount ($)"
                  value={discountPrice}
                  onChangeText={setDiscountPrice}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, { width: '48%' }]}
                />
                <TextInput
                  label="Original ($)"
                  value={originalPrice}
                  onChangeText={setOriginalPrice}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, { width: '48%' }]}
                />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Button mode="outlined" onPress={closeModal} disabled={isPublishing} style={{ width: '48%' }}>
                  Cancel
                </Button>
                <Button mode="contained" onPress={handlePublishDeal} loading={isPublishing} disabled={isPublishing} style={{ width: '48%' }}>
                  Publish Live
                </Button>
              </View>
            </View>
          )}
        </Modal>
      </Portal>
    </ScrollView>
  );
}

function ProfileTab({ theme }) {
  const { user, logout } = useAuth();
  return (
    <View style={[styles.tabContent, { alignItems: 'center', paddingTop: 40 }]}>
      <Avatar.Text size={80} label={user.name?.[0]?.toUpperCase() || '?'} style={{ backgroundColor: theme.colors.primary }} />
      <Text variant="titleLarge" style={{ marginTop: 12 }}>{user.name}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{user.email}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
        Customer • Kampong Eco Champion 🌿
      </Text>
      <Button mode="contained" buttonColor={theme.colors.error} onPress={logout} style={{ marginTop: 24 }}>
        Log Out
      </Button>
    </View>
  );
}

export default function CustomerScreen() {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'food', title: 'Food', focusedIcon: 'food', unfocusedIcon: 'food-outline' },
    { key: 'profile', title: 'Profile', focusedIcon: 'account', unfocusedIcon: 'account-outline' },
  ]);

  const renderScene = BottomNavigation.SceneMap({
    food: () => <FoodTab theme={theme} />,
    profile: () => <ProfileTab theme={theme} />,
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <Surface style={styles.header} elevation={1}>
        <Text variant="titleLarge">♻️ KampongCycle</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Rescuing surplus hawker food
        </Text>
      </Surface>
      <BottomNavigation
        navigationState={{ index, routes }}
        onIndexChange={setIndex}
        renderScene={renderScene}
        shifting={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: 40 },
  tabContent: { flex: 1, padding: 16 },
  impactBanner: { borderRadius: 16, padding: 16, marginBottom: 12, alignItems: 'center' },
  impactCount: { color: '#fff', fontWeight: 'bold' },
  impactLabel: { color: '#fff', marginTop: 2, textAlign: 'center' },
  aiCard: { marginBottom: 12, borderRadius: 16 },
  sectionTitle: { marginBottom: 12, marginTop: 4, fontWeight: 'bold' },
  emptyText: { fontStyle: 'italic', marginBottom: 12, opacity: 0.7 },
  dealCard: { marginBottom: 12, borderRadius: 12 },
  dealCardContent: { flexDirection: 'row', alignItems: 'center' },
  modalContent: {
    backgroundColor: '#fff', margin: 20, padding: 20, borderRadius: 16,
  },
  modalImage: {
    width: 160, height: 120, borderRadius: 10, marginBottom: 8, alignSelf: 'center',
  },
  input: { marginBottom: 12 },
});
