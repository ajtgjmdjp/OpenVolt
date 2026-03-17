#include <gtest/gtest.h>
#include "core/risk/covariance.hpp"
#include "core/risk/risk_model.hpp"
#include <cmath>
#include <vector>

using namespace openvolt;

class RiskModelTest : public ::testing::Test {
protected:
    // Generate simple synthetic return data: 100 days, 3 assets
    Matrix make_returns() {
        Matrix returns(100, 3);
        // Asset 0: steady low vol
        // Asset 1: higher vol
        // Asset 2: correlated with asset 1
        for (int t = 0; t < 100; ++t) {
            double noise = std::sin(t * 0.5) * 0.01;
            returns(t, 0) = 0.001 + noise * 0.5;
            returns(t, 1) = 0.002 + noise * 2.0;
            returns(t, 2) = 0.0015 + noise * 1.5 + std::cos(t * 0.3) * 0.005;
        }
        return returns;
    }

    std::vector<Ticker> tickers = {"A", "B", "C"};
};

TEST_F(RiskModelTest, SampleCovarianceIsSymmetric) {
    auto returns = make_returns();
    SampleRiskModel model(100);
    auto cov = model.estimate(returns, tickers);

    ASSERT_EQ(cov.rows(), 3);
    ASSERT_EQ(cov.cols(), 3);

    // Symmetric
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            EXPECT_NEAR(cov(i, j), cov(j, i), 1e-10);
        }
    }

    // Positive diagonal
    for (int i = 0; i < 3; ++i) {
        EXPECT_GT(cov(i, i), 0.0);
    }
}

TEST_F(RiskModelTest, EWMACovarianceIsSymmetric) {
    auto returns = make_returns();
    EWMARiskModel model(0.97);
    auto cov = model.estimate(returns, tickers);

    ASSERT_EQ(cov.rows(), 3);
    ASSERT_EQ(cov.cols(), 3);

    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            EXPECT_NEAR(cov(i, j), cov(j, i), 1e-10);
        }
    }
}

TEST_F(RiskModelTest, ShrinkageCovarianceIsSymmetric) {
    auto returns = make_returns();
    ShrinkageRiskModel model;
    auto cov = model.estimate(returns, tickers);

    ASSERT_EQ(cov.rows(), 3);
    ASSERT_EQ(cov.cols(), 3);

    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            EXPECT_NEAR(cov(i, j), cov(j, i), 1e-10);
        }
    }
}

TEST_F(RiskModelTest, FactorCovarianceIsSymmetric) {
    auto returns = make_returns();
    FactorRiskModel model(2, 100, 60);
    auto cov = model.estimate(returns, tickers);

    ASSERT_EQ(cov.rows(), 3);
    ASSERT_EQ(cov.cols(), 3);

    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            EXPECT_NEAR(cov(i, j), cov(j, i), 1e-10);
        }
    }
}

TEST_F(RiskModelTest, BlendCovarianceIsBetween) {
    auto returns = make_returns();

    auto short_model = std::make_unique<EWMARiskModel>(0.94);
    auto long_model = std::make_unique<SampleRiskModel>(100);

    auto short_cov = EWMARiskModel(0.94).estimate(returns, tickers);
    auto long_cov = SampleRiskModel(100).estimate(returns, tickers);

    BlendRiskModel blend(
        std::make_unique<EWMARiskModel>(0.94),
        std::make_unique<SampleRiskModel>(100),
        0.7
    );
    auto blended = blend.estimate(returns, tickers);

    // Blended should be weighted average
    Matrix expected = 0.7 * short_cov + 0.3 * long_cov;
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            EXPECT_NEAR(blended(i, j), expected(i, j), 1e-10);
        }
    }
}

TEST_F(RiskModelTest, ExAnteTrackingError) {
    Matrix cov = Matrix::Identity(3, 3) * 0.04;  // 20% annual vol per asset
    Vector active = Vector::Zero(3);
    active(0) = 0.1;   // 10% overweight
    active(1) = -0.1;  // 10% underweight

    double te = ex_ante_tracking_error(active, cov);
    // TE = sqrt(w' * I * w * 252) with w'*I*w = 0.01 + 0.01 = 0.02
    // = sqrt(0.02 * 0.04 * 252) = sqrt(0.2016) ≈ 0.449
    EXPECT_GT(te, 0.0);
    EXPECT_LT(te, 1.0);
}

TEST_F(RiskModelTest, FactoryCreatesAllModels) {
    EXPECT_EQ(make_risk_model("sample")->name(), "sample");
    EXPECT_EQ(make_risk_model("ewma")->name(), "ewma");
    EXPECT_EQ(make_risk_model("shrinkage")->name(), "shrinkage");
    EXPECT_EQ(make_risk_model("factor")->name(), "factor");
    EXPECT_EQ(make_risk_model("blend")->name(), "blend");

    EXPECT_THROW(make_risk_model("unknown"), std::invalid_argument);
}
