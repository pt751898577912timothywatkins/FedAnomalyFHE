// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FederatedAnomalyFHE is SepoliaConfig {
    struct EncryptedDataBatch {
        uint256 batchId;
        euint32 encryptedFeatures;    // Encrypted feature vectors
        euint32 encryptedLabels;     // Encrypted anomaly labels
        uint256 participantId;       // Organization ID
        uint256 timestamp;
    }

    struct EncryptedModelUpdate {
        uint256 updateId;
        euint32 encryptedWeights;    // Encrypted model weights
        euint32 encryptedBias;      // Encrypted model bias
        uint256 participantId;      // Organization ID
        uint256 timestamp;
    }

    struct DecryptedResult {
        uint32 anomalyScore;
        bool isAnomaly;
        bool isRevealed;
    }

    uint256 public batchCount;
    uint256 public updateCount;
    uint256 public participantCount;
    mapping(uint256 => EncryptedDataBatch) public encryptedBatches;
    mapping(uint256 => EncryptedModelUpdate) public encryptedUpdates;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    mapping(uint256 => uint256) private requestToBatchId;
    mapping(uint256 => uint256) private resultRequestToId;
    
    event BatchSubmitted(uint256 indexed batchId, uint256 participantId, uint256 timestamp);
    event ModelUpdated(uint256 indexed updateId, uint256 participantId, uint256 timestamp);
    event DetectionRequested(uint256 indexed requestId, uint256 batchId);
    event ResultDecrypted(uint256 indexed resultId);

    modifier onlyParticipant(uint256 participantId) {
        // Add proper participant authentication in production
        _;
    }

    function registerParticipant() public {
        participantCount += 1;
    }

    function submitEncryptedDataBatch(
        euint32 encryptedFeatures,
        euint32 encryptedLabels,
        uint256 participantId
    ) public onlyParticipant(participantId) {
        batchCount += 1;
        uint256 newBatchId = batchCount;
        
        encryptedBatches[newBatchId] = EncryptedDataBatch({
            batchId: newBatchId,
            encryptedFeatures: encryptedFeatures,
            encryptedLabels: encryptedLabels,
            participantId: participantId,
            timestamp: block.timestamp
        });
        
        emit BatchSubmitted(newBatchId, participantId, block.timestamp);
    }

    function submitModelUpdate(
        euint32 encryptedWeights,
        euint32 encryptedBias,
        uint256 participantId
    ) public onlyParticipant(participantId) {
        updateCount += 1;
        uint256 newUpdateId = updateCount;
        
        encryptedUpdates[newUpdateId] = EncryptedModelUpdate({
            updateId: newUpdateId,
            encryptedWeights: encryptedWeights,
            encryptedBias: encryptedBias,
            participantId: participantId,
            timestamp: block.timestamp
        });
        
        emit ModelUpdated(newUpdateId, participantId, block.timestamp);
    }

    function requestAnomalyDetection(uint256 batchId) public {
        EncryptedDataBatch storage batch = encryptedBatches[batchId];
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(batch.encryptedFeatures);
        ciphertexts[1] = FHE.toBytes32(batch.encryptedLabels);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.detectAnomalies.selector);
        requestToBatchId[reqId] = batchId;
        
        emit DetectionRequested(reqId, batchId);
    }

    function detectAnomalies(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 batchId = requestToBatchId[requestId];
        require(batchId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32[] memory features, uint32[] memory labels) = abi.decode(cleartexts, (uint32[], uint32[]));
        
        // Simplified anomaly detection (in production this would use FHE ML model)
        uint32 score = calculateAnomalyScore(features);
        bool isAnomaly = score > 50; // Threshold for demo purposes
        
        // Store result (in production this would remain encrypted)
        uint256 resultId = batchId; // Using batchId as resultId for simplicity
        decryptedResults[resultId] = DecryptedResult({
            anomalyScore: score,
            isAnomaly: isAnomaly,
            isRevealed: true
        });
        
        emit ResultDecrypted(resultId);
    }

    function getDecryptedResult(uint256 resultId) public view returns (
        uint32 anomalyScore,
        bool isAnomaly,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[resultId];
        return (r.anomalyScore, r.isAnomaly, r.isRevealed);
    }

    function getEncryptedBatch(uint256 batchId) public view returns (
        euint32 features,
        euint32 labels,
        uint256 participantId,
        uint256 timestamp
    ) {
        EncryptedDataBatch storage b = encryptedBatches[batchId];
        return (b.encryptedFeatures, b.encryptedLabels, b.participantId, b.timestamp);
    }

    function getEncryptedUpdate(uint256 updateId) public view returns (
        euint32 weights,
        euint32 bias,
        uint256 participantId,
        uint256 timestamp
    ) {
        EncryptedModelUpdate storage u = encryptedUpdates[updateId];
        return (u.encryptedWeights, u.encryptedBias, u.participantId, u.timestamp);
    }

    // Helper function for simplified anomaly detection
    function calculateAnomalyScore(uint32[] memory features) private pure returns (uint32) {
        uint32 sum = 0;
        for (uint i = 0; i < features.length; i++) {
            sum += features[i];
        }
        return sum / uint32(features.length);
    }
}