#include "core/optimizer/qp_solver.hpp"
#include <osqp.h>

namespace openvolt {

class OSQPSolverImpl final : public IQPSolver {
public:
    OSQPSolverImpl(double eps_abs, double eps_rel, int max_iter, bool verbose)
        : eps_abs_(eps_abs), eps_rel_(eps_rel), max_iter_(max_iter), verbose_(verbose) {}

    QPSolution solve(const QPProblem& problem) override {
        QPSolution result;

        const int n = static_cast<int>(problem.P.cols());
        const int m = static_cast<int>(problem.A.rows());

        // Ensure compressed format
        Eigen::SparseMatrix<double, Eigen::ColMajor, OSQPInt> P = problem.P;
        Eigen::SparseMatrix<double, Eigen::ColMajor, OSQPInt> A = problem.A;
        P.makeCompressed();
        A.makeCompressed();

        OSQPCscMatrix P_csc;
        P_csc.m = n; P_csc.n = n;
        P_csc.nzmax = P.nonZeros();
        P_csc.x = const_cast<double*>(P.valuePtr());
        P_csc.i = const_cast<OSQPInt*>(P.innerIndexPtr());
        P_csc.p = const_cast<OSQPInt*>(P.outerIndexPtr());
        P_csc.nz = -1;

        OSQPCscMatrix A_csc;
        A_csc.m = m; A_csc.n = n;
        A_csc.nzmax = A.nonZeros();
        A_csc.x = const_cast<double*>(A.valuePtr());
        A_csc.i = const_cast<OSQPInt*>(A.innerIndexPtr());
        A_csc.p = const_cast<OSQPInt*>(A.outerIndexPtr());
        A_csc.nz = -1;

        OSQPSolver* solver = nullptr;
        OSQPSettings settings;
        osqp_set_default_settings(&settings);
        settings.verbose = verbose_;
        settings.eps_abs = eps_abs_;
        settings.eps_rel = eps_rel_;
        settings.max_iter = max_iter_;

        Vec q_copy = problem.q;
        Vec l_copy = problem.l;
        Vec u_copy = problem.u;

        OSQPInt flag = osqp_setup(
            &solver, &P_csc, q_copy.data(), &A_csc,
            l_copy.data(), u_copy.data(), m, n, &settings
        );

        if (flag != 0) {
            result.status = "setup_failed";
            return result;
        }

        flag = osqp_solve(solver);

        if (flag == 0 && solver->info->status_val == OSQP_SOLVED) {
            result.solved = true;
            result.status = "solved";
            result.x = Eigen::Map<const Vec>(solver->solution->x, n);
            result.objective = solver->info->obj_val;
            result.iterations = static_cast<int>(solver->info->iter);
        } else {
            result.status = solver->info->status;
        }

        osqp_cleanup(solver);
        return result;
    }

    [[nodiscard]] std::string name() const override { return "osqp"; }

private:
    double eps_abs_;
    double eps_rel_;
    int max_iter_;
    bool verbose_;
};

std::unique_ptr<IQPSolver> make_osqp_solver(
    double eps_abs, double eps_rel, int max_iter, bool verbose
) {
    return std::make_unique<OSQPSolverImpl>(eps_abs, eps_rel, max_iter, verbose);
}

} // namespace openvolt
