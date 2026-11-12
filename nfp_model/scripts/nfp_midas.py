"""Weekly source selection and a compact, profiled exponential-Almon MIDAS model."""
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import softmax

import train_nfp_ridge as base


def weekly_slots(targets, weekly, prefix, weeks=12):
    if weekly.week_ending.duplicated().any():
        raise ValueError('Weekly source must have a unique first-release observation per week')
    source = weekly.set_index('week_ending').to_dict('index')
    result = pd.DataFrame(index=targets.index, columns=[f'{prefix}_week_{j:02d}' for j in range(1,weeks+1)], dtype=float)
    evidence = []
    for index, row in targets.iterrows():
        eligible = weekly[weekly.release_date < row.release_date]
        anchor = eligible.week_ending.max() if len(eligible) else None
        for j in range(1, weeks+1):
            week = (pd.Timestamp(anchor)-pd.Timedelta(days=7*(j-1))).strftime('%Y-%m-%d') if anchor else None
            item = source.get(week)
            available = item is not None and item['release_date'] < row.release_date
            if available:
                result.at[index,f'{prefix}_week_{j:02d}'] = float(item['value'])
            evidence.append({'target_month':row.target_month,'nfp_release_date':row.release_date,'series':prefix,
                             'lag':j,'week_ending':week,'release_date':item['release_date'] if item else None,
                             'value':float(item['value']) if available else None,
                             'source_url':item.get('source_url') if item else None,
                             'status':'available' if available else 'no_available_history' if not anchor else
                             'not_yet_published' if item else 'missing_source_week'})
    return result, evidence


def almon_weights(theta, weeks):
    z = np.linspace(0.,1.,weeks)
    return softmax(theta[0]*z + theta[1]*z*z)


def medians(x):
    return np.array([np.median(col[np.isfinite(col)]) if np.isfinite(col).any() else 0. for col in x.T])


class AlmonMIDAS:
    """Controls first, then K IC slots and K CC slots; penalized linear profile fit.

    Nonlinear parameters only select the two series' lag weights. All imputation,
    feature scaling, target scaling and missingness terms use fitting rows only.
    """
    def __init__(self, weeks=8, controls=5, alpha=1., maxiter=80):
        self.weeks, self.controls, self.alpha, self.maxiter = weeks, controls, alpha, maxiter

    def _prepare(self, x, fit=False):
        x = np.asarray(x,dtype=float)
        if x.shape[1] != self.controls + 2*self.weeks:
            raise ValueError('Unexpected MIDAS feature layout')
        if fit:
            self.medians_ = medians(x)
        filled = np.where(np.isnan(x),self.medians_,x)
        if fit:
            self.control_mean_ = filled[:,:self.controls].mean(0)
            self.control_scale_ = filled[:,:self.controls].std(0)
            self.control_scale_[self.control_scale_ == 0] = 1.
            self.weekly_mean_, self.weekly_scale_ = [], []
            for group in range(2):
                block = filled[:,self.controls+group*self.weeks:self.controls+(group+1)*self.weeks]
                self.weekly_mean_.append(float(block.mean()))
                self.weekly_scale_.append(float(block.std()) or 1.)
        controls = np.column_stack([(filled[:,:self.controls]-self.control_mean_)/self.control_scale_,
                                    np.isnan(x[:,:self.controls]).astype(float)])
        weekly, missing = [], []
        for group in range(2):
            start = self.controls + group*self.weeks
            weekly.append((filled[:,start:start+self.weeks]-self.weekly_mean_[group])/self.weekly_scale_[group])
            missing.append(np.isnan(x[:,start:start+self.weeks]).mean(1))
        return controls, weekly, np.column_stack(missing)

    def _design(self, prepared, theta):
        controls, weekly, missing = prepared
        return np.column_stack([controls,weekly[0]@almon_weights(theta[:2],self.weeks),
                                weekly[1]@almon_weights(theta[2:],self.weeks),missing])

    def _profile(self, design, y):
        center, target_mean = design.mean(0), float(y.mean())
        z, target = design-center,y-target_mean
        coef = np.linalg.solve(z.T@z+self.alpha*np.eye(z.shape[1]),z.T@target)
        residual = target-z@coef
        loss = float(residual@residual+self.alpha*(coef@coef))
        return loss,coef,center,target_mean

    def fit(self, x, y):
        x,y = np.asarray(x,dtype=float),np.asarray(y,dtype=float)
        self.y_mean_,self.y_scale_ = float(y.mean()),float(y.std()) or 1.
        scaled = (y-self.y_mean_)/self.y_scale_
        prepared = self._prepare(x,fit=True)
        self.optimization_ = []
        solutions = []
        for start in [np.zeros(4),np.array([-2.,0.,-2.,0.])]:
            result = minimize(lambda theta:self._profile(self._design(prepared,theta),scaled)[0],start,
                              method='L-BFGS-B',bounds=[(-8.,8.)]*4,
                              options={'maxiter':self.maxiter,'maxfun':600,'ftol':1e-7})
            self.optimization_.append({'success':bool(result.success),'evaluations':int(result.nfev),
                                       'loss':float(result.fun),'message':str(result.message)})
            if result.success and np.isfinite(result.fun):
                solutions.append(result)
        if not solutions:
            self.status_ = 'u_midas_optimizer_fallback'
            self.fallback_ = base.make_pipeline(self.alpha).fit(x,y)
        else:
            best = min(solutions,key=lambda r:r.fun)
            self.theta_ = best.x
            _,self.coef_,self.design_center_,self.target_center_ = self._profile(self._design(prepared,self.theta_),scaled)
            self.status_ = 'converged'
            self.weights_ = np.vstack([almon_weights(self.theta_[:2],self.weeks),almon_weights(self.theta_[2:],self.weeks)])
        return self

    def predict(self, x):
        if self.status_ == 'u_midas_optimizer_fallback':
            return self.fallback_.predict(np.asarray(x,dtype=float))
        design = self._design(self._prepare(x),self.theta_)
        standardized = (design-self.design_center_)@self.coef_+self.target_center_
        return standardized*self.y_scale_+self.y_mean_
