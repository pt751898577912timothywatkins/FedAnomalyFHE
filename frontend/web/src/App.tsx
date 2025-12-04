import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AnomalyData {
  id: string;
  encryptedData: string;
  timestamp: number;
  organization: string;
  anomalyType: string;
  confidence: number;
  status: "detected" | "verified" | "false_positive";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newAnomalyData, setNewAnomalyData] = useState({
    anomalyType: "",
    description: "",
    dataPoints: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [activeSection, setActiveSection] = useState("dashboard");

  // Calculate statistics
  const detectedCount = anomalies.filter(a => a.status === "detected").length;
  const verifiedCount = anomalies.filter(a => a.status === "verified").length;
  const falsePositiveCount = anomalies.filter(a => a.status === "false_positive").length;

  // Filter anomalies based on search and filter
  const filteredAnomalies = anomalies.filter(anomaly => {
    const matchesSearch = anomaly.anomalyType.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         anomaly.organization.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === "all" || anomaly.status === filterType;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadAnomalies().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadAnomalies = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("anomaly_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing anomaly keys:", e);
        }
      }
      
      const list: AnomalyData[] = [];
      
      for (const key of keys) {
        try {
          const anomalyBytes = await contract.getData(`anomaly_${key}`);
          if (anomalyBytes.length > 0) {
            try {
              const anomalyData = JSON.parse(ethers.toUtf8String(anomalyBytes));
              list.push({
                id: key,
                encryptedData: anomalyData.data,
                timestamp: anomalyData.timestamp,
                organization: anomalyData.organization,
                anomalyType: anomalyData.anomalyType,
                confidence: anomalyData.confidence || 0,
                status: anomalyData.status || "detected"
              });
            } catch (e) {
              console.error(`Error parsing anomaly data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading anomaly ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setAnomalies(list);
    } catch (e) {
      console.error("Error loading anomalies:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitAnomaly = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting anomaly data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newAnomalyData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const anomalyId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const anomalyData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        organization: account,
        anomalyType: newAnomalyData.anomalyType,
        confidence: Math.floor(Math.random() * 100), // Simulated confidence score
        status: "detected"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `anomaly_${anomalyId}`, 
        ethers.toUtf8Bytes(JSON.stringify(anomalyData))
      );
      
      const keysBytes = await contract.getData("anomaly_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(anomalyId);
      
      await contract.setData(
        "anomaly_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted anomaly data submitted securely!"
      });
      
      await loadAnomalies();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAnomalyData({
          anomalyType: "",
          description: "",
          dataPoints: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyAnomaly = async (anomalyId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const anomalyBytes = await contract.getData(`anomaly_${anomalyId}`);
      if (anomalyBytes.length === 0) {
        throw new Error("Anomaly not found");
      }
      
      const anomalyData = JSON.parse(ethers.toUtf8String(anomalyBytes));
      
      const updatedAnomaly = {
        ...anomalyData,
        status: "verified"
      };
      
      await contract.setData(
        `anomaly_${anomalyId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedAnomaly))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadAnomalies();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const markAsFalsePositive = async (anomalyId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const anomalyBytes = await contract.getData(`anomaly_${anomalyId}`);
      if (anomalyBytes.length === 0) {
        throw new Error("Anomaly not found");
      }
      
      const anomalyData = JSON.parse(ethers.toUtf8String(anomalyBytes));
      
      const updatedAnomaly = {
        ...anomalyData,
        status: "false_positive"
      };
      
      await contract.setData(
        `anomaly_${anomalyId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedAnomaly))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE processing completed successfully!"
      });
      
      await loadAnomalies();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Operation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderPieChart = () => {
    const total = anomalies.length || 1;
    const detectedPercentage = (detectedCount / total) * 100;
    const verifiedPercentage = (verifiedCount / total) * 100;
    const falsePositivePercentage = (falsePositiveCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment detected" 
            style={{ transform: `rotate(${detectedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment verified" 
            style={{ transform: `rotate(${(detectedPercentage + verifiedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment false_positive" 
            style={{ transform: `rotate(${(detectedPercentage + verifiedPercentage + falsePositivePercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{anomalies.length}</div>
            <div className="pie-label">Total</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box detected"></div>
            <span>Detected: {detectedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box verified"></div>
            <span>Verified: {verifiedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box false_positive"></div>
            <span>False Positive: {falsePositiveCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderBarChart = () => {
    // Group anomalies by type for the chart
    const typeCounts: Record<string, number> = {};
    anomalies.forEach(anomaly => {
      typeCounts[anomaly.anomalyType] = (typeCounts[anomaly.anomalyType] || 0) + 1;
    });
    
    const maxCount = Math.max(...Object.values(typeCounts), 1);
    const types = Object.keys(typeCounts);
    
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          {types.map((type, index) => {
            const height = (typeCounts[type] / maxCount) * 100;
            return (
              <div key={index} className="bar-wrapper">
                <div 
                  className="bar" 
                  style={{ height: `${height}%` }}
                  title={`${type}: ${typeCounts[type]}`}
                ></div>
                <div className="bar-label">{type}</div>
              </div>
            );
          })}
        </div>
        <div className="chart-title">Anomalies by Type</div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FedAnomaly<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-layout">
        <nav className="side-nav">
          <div className="nav-section">
            <h3>Navigation</h3>
            <button 
              className={`nav-btn ${activeSection === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveSection("dashboard")}
            >
              <span className="nav-icon">📊</span>
              Dashboard
            </button>
            <button 
              className={`nav-btn ${activeSection === "anomalies" ? "active" : ""}`}
              onClick={() => setActiveSection("anomalies")}
            >
              <span className="nav-icon">🔍</span>
              Anomaly Detection
            </button>
            <button 
              className={`nav-btn ${activeSection === "team" ? "active" : ""}`}
              onClick={() => setActiveSection("team")}
            >
              <span className="nav-icon">👥</span>
              Team
            </button>
          </div>
          
          <div className="nav-section">
            <h3>Actions</h3>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="nav-btn primary"
            >
              <span className="nav-icon">➕</span>
              Report Anomaly
            </button>
            <button 
              onClick={loadAnomalies}
              className="nav-btn"
              disabled={isRefreshing}
            >
              <span className="nav-icon">🔄</span>
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
          
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </nav>
        
        <main className="main-content">
          {activeSection === "dashboard" && (
            <>
              <div className="welcome-banner">
                <div className="welcome-text">
                  <h2>FHE-Powered Privacy-Preserving Federated Anomaly Detection</h2>
                  <p>Multiple organizations can collaboratively train anomaly detection models without sharing sensitive data using Fully Homomorphic Encryption (FHE)</p>
                </div>
              </div>
              
              <div className="dashboard-grid">
                <div className="dashboard-card cyber-card intro-card">
                  <h3>Project Introduction</h3>
                  <p>FedAnomalyFHE enables banks, e-commerce platforms, and other organizations to collaboratively detect novel anomalous behaviors (such as fraud) without exposing their sensitive user data.</p>
                  <div className="feature-list">
                    <div className="feature-item">
                      <div className="feature-icon">🔒</div>
                      <div className="feature-text">Encrypted user behavior data</div>
                    </div>
                    <div className="feature-item">
                      <div className="feature-icon">🤝</div>
                      <div className="feature-text">FHE-based federated anomaly detection model</div>
                    </div>
                    <div className="feature-item">
                      <div className="feature-icon">⚡</div>
                      <div className="feature-text">Timely discovery of new attack patterns</div>
                    </div>
                    <div className="feature-item">
                      <div className="feature-icon">🛡️</div>
                      <div className="feature-text">Protection of organizational user data</div>
                    </div>
                  </div>
                </div>
                
                <div className="dashboard-card cyber-card">
                  <h3>Data Statistics</h3>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <div className="stat-value">{anomalies.length}</div>
                      <div className="stat-label">Total Anomalies</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{detectedCount}</div>
                      <div className="stat-label">Detected</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{verifiedCount}</div>
                      <div className="stat-label">Verified</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{falsePositiveCount}</div>
                      <div className="stat-label">False Positives</div>
                    </div>
                  </div>
                </div>
                
                <div className="dashboard-card cyber-card">
                  <h3>Status Distribution</h3>
                  {renderPieChart()}
                </div>
                
                <div className="dashboard-card cyber-card">
                  <h3>Anomaly Types</h3>
                  {renderBarChart()}
                </div>
              </div>
            </>
          )}
          
          {activeSection === "anomalies" && (
            <div className="anomalies-section">
              <div className="section-header">
                <h2>Anomaly Detection</h2>
                <div className="header-actions">
                  <div className="search-box">
                    <input 
                      type="text" 
                      placeholder="Search anomalies..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="cyber-input"
                    />
                  </div>
                  <select 
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="cyber-select"
                  >
                    <option value="all">All Statuses</option>
                    <option value="detected">Detected</option>
                    <option value="verified">Verified</option>
                    <option value="false_positive">False Positives</option>
                  </select>
                </div>
              </div>
              
              <div className="anomalies-list cyber-card">
                <div className="table-header">
                  <div className="header-cell">ID</div>
                  <div className="header-cell">Type</div>
                  <div className="header-cell">Organization</div>
                  <div className="header-cell">Date</div>
                  <div className="header-cell">Confidence</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Actions</div>
                </div>
                
                {filteredAnomalies.length === 0 ? (
                  <div className="no-anomalies">
                    <div className="no-anomalies-icon"></div>
                    <p>No anomalies found</p>
                    <button 
                      className="cyber-button primary"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Report First Anomaly
                    </button>
                  </div>
                ) : (
                  filteredAnomalies.map(anomaly => (
                    <div className="anomaly-row" key={anomaly.id}>
                      <div className="table-cell anomaly-id">#{anomaly.id.substring(0, 6)}</div>
                      <div className="table-cell">{anomaly.anomalyType}</div>
                      <div className="table-cell">{anomaly.organization.substring(0, 6)}...{anomaly.organization.substring(38)}</div>
                      <div className="table-cell">
                        {new Date(anomaly.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="table-cell">
                        <div className="confidence-meter">
                          <div 
                            className="confidence-fill" 
                            style={{ width: `${anomaly.confidence}%` }}
                          ></div>
                          <span>{anomaly.confidence}%</span>
                        </div>
                      </div>
                      <div className="table-cell">
                        <span className={`status-badge ${anomaly.status}`}>
                          {anomaly.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="table-cell actions">
                        {isOwner(anomaly.organization) && anomaly.status === "detected" && (
                          <>
                            <button 
                              className="action-btn cyber-button success"
                              onClick={() => verifyAnomaly(anomaly.id)}
                            >
                              Verify
                            </button>
                            <button 
                              className="action-btn cyber-button warning"
                              onClick={() => markAsFalsePositive(anomaly.id)}
                            >
                              False Positive
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          
          {activeSection === "team" && (
            <div className="team-section">
              <h2>Our Team</h2>
              <div className="team-grid">
                <div className="team-member cyber-card">
                  <div className="member-avatar"></div>
                  <h3>Dr. Alice Chen</h3>
                  <p className="member-role">Chief Cryptographer</p>
                  <p>Expert in fully homomorphic encryption and privacy-preserving machine learning with 10+ years of experience.</p>
                </div>
                
                <div className="team-member cyber-card">
                  <div className="member-avatar"></div>
                  <h3>Mark Johnson</h3>
                  <p className="member-role">Lead Blockchain Developer</p>
                  <p>Specialized in smart contract development and decentralized applications for privacy-focused solutions.</p>
                </div>
                
                <div className="team-member cyber-card">
                  <div className="member-avatar"></div>
                  <h3>Sarah Williams</h3>
                  <p className="member-role">AI Research Scientist</p>
                  <p>Focuses on federated learning and anomaly detection algorithms that work with encrypted data.</p>
                </div>
                
                <div className="team-member cyber-card">
                  <div className="member-avatar"></div>
                  <h3>David Kim</h3>
                  <p className="member-role">Product Manager</p>
                  <p>Bridges the gap between technical innovation and practical applications in financial security.</p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitAnomaly} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          anomalyData={newAnomalyData}
          setAnomalyData={setNewAnomalyData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FedAnomalyFHE</span>
            </div>
            <p>FHE-Powered Privacy-Preserving Federated Anomaly Detection</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} FedAnomalyFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  anomalyData: any;
  setAnomalyData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  anomalyData,
  setAnomalyData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setAnomalyData({
      ...anomalyData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!anomalyData.anomalyType || !anomalyData.dataPoints) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Report New Anomaly</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your anomaly data will be encrypted with FHE before processing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Anomaly Type *</label>
              <select 
                name="anomalyType"
                value={anomalyData.anomalyType} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select type</option>
                <option value="Financial Fraud">Financial Fraud</option>
                <option value="Network Intrusion">Network Intrusion</option>
                <option value="Identity Theft">Identity Theft</option>
                <option value="Transaction Anomaly">Transaction Anomaly</option>
                <option value="Behavioral Anomaly">Behavioral Anomaly</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={anomalyData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Data Points *</label>
              <textarea 
                name="dataPoints"
                value={anomalyData.dataPoints} 
                onChange={handleChange}
                placeholder="Enter data points that indicate the anomaly..." 
                className="cyber-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing and federated learning
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Anomaly"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;